# mypy: allow-untyped-defs

import collections
import os
import time
import traceback
from typing import Mapping, MutableMapping, Type
from urllib.parse import urljoin

from webdriver import error

from .base import (
    CrashtestExecutor,
    TestharnessExecutor,
    get_pages,
)
from .executorwebdriver import (
    WebDriverCrashtestExecutor,
    WebDriverFedCMProtocolPart,
    WebDriverProtocol,
    WebDriverRefTestExecutor,
    WebDriverRun,
    WebDriverTestharnessExecutor,
    WebDriverTestharnessProtocolPart,
)
from .protocol import LeakProtocolPart, PrintProtocolPart, ProtocolPart

here = os.path.dirname(__file__)


def make_sanitizer_mixin(crashtest_executor_cls: Type[CrashtestExecutor]):  # type: ignore[no-untyped-def]
    class SanitizerMixin:
        def __new__(cls, logger, browser, **kwargs):
            # Overriding `__new__` is the least worst way we can force tests to run
            # as crashtests at runtime while still supporting:
            #   * Class attributes (e.g., `extra_timeout`)
            #   * Pickleability for `multiprocessing` transport
            #   * The `__wptrunner__` product interface
            #
            # These requirements rule out approaches with `functools.partial(...)`
            # or global variables.
            if kwargs.get("sanitizer_enabled"):
                executor = crashtest_executor_cls(logger, browser, **kwargs)

                def convert_from_crashtest_result(test, result):
                    if issubclass(cls, TestharnessExecutor):
                        status = result["status"]
                        if status == "PASS":
                            status = "OK"
                        harness_result = test.make_result(status, result["message"])
                        # Don't report subtests.
                        return harness_result, []
                    # `crashtest` statuses are a subset of `(print-)reftest`
                    # ones, so no extra conversion necessary.
                    return cls.convert_result(executor, test, result)

                executor.convert_result = convert_from_crashtest_result
                return executor
            return super().__new__(cls)
    return SanitizerMixin


_SanitizerMixin = make_sanitizer_mixin(WebDriverCrashtestExecutor)


class ChromeDriverLeakProtocolPart(LeakProtocolPart):
    def get_counters(self) -> Mapping[str, int]:
        response = self.parent.cdp.execute_cdp_command("Memory.getDOMCountersForLeakDetection")
        counters: MutableMapping[str, int] = collections.Counter({
            counter["name"]: counter["count"]
            for counter in response["counters"]
        })
        # Exclude resources associated with User Agent CSS from leak detection,
        # since they are persisted through page navigation.
        counters["live_resources"] -= counters.pop("live_ua_css_resources", 0)
        return counters


class ChromeDriverTestharnessProtocolPart(WebDriverTestharnessProtocolPart):
    """Implementation of `testharness.js` tests controlled by ChromeDriver.

    The main difference from the default WebDriver testharness implementation is
    that the test window can be reused between tests for better performance.
    """

    def setup(self):
        super().setup()
        # Handle (an alphanumeric string) that may be set if window reuse is
        # enabled. This state allows the protocol to distinguish the test
        # window from other windows a test itself may create that the "Get
        # Window Handles" command also returns.
        #
        # Because test window persistence is a Chrome-only feature, it's not
        # exposed to the base WebDriver testharness executor.
        self.test_window = None
        self.reuse_window = self.parent.reuse_window

    def close_test_window(self):
        if self.test_window:
            self._close_window(self.test_window)
            self.test_window = None

    def close_old_windows(self):
        self.webdriver.actions.release()
        for handle in self.webdriver.handles:
            if handle not in {self.runner_handle, self.test_window}:
                self._close_window(handle)
        if not self.reuse_window:
            self.close_test_window()
        self.webdriver.window_handle = self.runner_handle
        return self.runner_handle

    def open_test_window(self, window_id):
        if self.test_window:
            # Try to reuse the existing test window by emulating the `about:blank`
            # page with no history you would get with a new window.
            try:
                self.webdriver.window_handle = self.test_window
                # Reset navigation history with Chrome DevTools Protocol:
                # https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-resetNavigationHistory
                self.parent.cdp.execute_cdp_command("Page.resetNavigationHistory")
                self.webdriver.url = "about:blank"
                return
            except error.NoSuchWindowException:
                self.test_window = None
        super().open_test_window(window_id)

    def get_test_window(self, window_id, parent, timeout=5):
        if self.test_window:
            return self.test_window
        # Poll the handles endpoint for the test window like the base WebDriver
        # protocol part, but don't bother checking for the serialized
        # WindowProxy (not supported by Chrome currently).
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.test_window = self._poll_handles_for_test_window(parent)
            if self.test_window is not None:
                assert self.test_window != parent
                return self.test_window
            time.sleep(0.03)
        raise Exception("unable to find test window")


class ChromeDriverPrintProtocolPart(PrintProtocolPart):
    def setup(self):
        self.webdriver = self.parent.webdriver
        self.runner_handle = None

    def load_runner(self):
        url = urljoin(self.parent.executor.server_url("http"), "/print_pdf_runner.html")
        self.logger.debug("Loading %s" % url)
        try:
            self.webdriver.url = url
        except Exception as e:
            self.logger.critical(
                "Loading initial page %s failed. Ensure that the "
                "there are no other programs bound to this port and "
                "that your firewall rules or network setup does not "
                "prevent access.\n%s" % (url, traceback.format_exc(e)))
            raise
        self.runner_handle = self.webdriver.window_handle

    def render_as_pdf(self, width, height):
        margin = 0.5
        params = {
            # Chrome accepts dimensions in inches; we are using cm
            "paperWidth": width / 2.54,
            "paperHeight": height / 2.54,
            "marginLeft": margin,
            "marginRight": margin,
            "marginTop": margin,
            "marginBottom": margin,
            "shrinkToFit": False,
            "printBackground": True,
        }
        return self.parent.cdp.execute_cdp_command("Page.printToPDF", params)["data"]

    def pdf_to_png(self, pdf_base64, ranges):
        handle = self.webdriver.window_handle
        self.webdriver.window_handle = self.runner_handle
        try:
            rv = self.webdriver.execute_async_script("""
let callback = arguments[arguments.length - 1];
render('%s').then(result => callback(result))""" % pdf_base64)
            page_numbers = get_pages(ranges, len(rv))
            rv = [item for i, item in enumerate(rv) if i + 1 in page_numbers]
            return rv
        finally:
            self.webdriver.window_handle = handle


class ChromeDriverFedCMProtocolPart(WebDriverFedCMProtocolPart):
    def confirm_idp_login(self):
        return self.webdriver.send_session_command("POST",
                                                   f"{self.parent.vendor_prefix}/fedcm/confirmidplogin")


class ChromeDriverDevToolsProtocolPart(ProtocolPart):
    """A low-level API for sending Chrome DevTools Protocol [0] commands directly to the browser.

    Prefer using standard APIs where possible.

    [0]: https://chromedevtools.github.io/devtools-protocol/
    """
    name = "cdp"

    def setup(self):
        self.webdriver = self.parent.webdriver

    def execute_cdp_command(self, command, params=None):
        body = {"cmd": command, "params": params or {}}
        return self.webdriver.send_session_command("POST",
                                                   f"{self.parent.vendor_prefix}/cdp/execute",
                                                   body=body)


class ChromeDriverProtocol(WebDriverProtocol):
    implements = [
        ChromeDriverDevToolsProtocolPart,
        ChromeDriverFedCMProtocolPart,
        ChromeDriverPrintProtocolPart,
        ChromeDriverTestharnessProtocolPart,
    ]
    for base_part in WebDriverProtocol.implements:
        if base_part.name not in {part.name for part in implements}:
            implements.append(base_part)

    reuse_window = False
    # Prefix to apply to vendor-specific WebDriver extension commands.
    vendor_prefix = "goog"

    def __init__(self, executor, browser, capabilities, **kwargs):
        self.implements = list(ChromeDriverProtocol.implements)
        if getattr(browser, "leak_check", False):
            self.implements.append(ChromeDriverLeakProtocolPart)
        super().__init__(executor, browser, capabilities, **kwargs)


def _evaluate_leaks(executor_cls):
    if hasattr(executor_cls, "base_convert_result"):
        # Don't wrap more than once, which can cause unbounded recursion.
        return executor_cls
    executor_cls.base_convert_result = executor_cls.convert_result

    def convert_result(self, test, result, **kwargs):
        test_result, subtest_results = self.base_convert_result(test, result, **kwargs)
        if test_result.extra.get("leak_counters"):
            test_result = test.make_result("CRASH",
                                           test_result.message,
                                           test_result.expected,
                                           test_result.extra,
                                           test_result.stack,
                                           test_result.known_intermittent)
        return test_result, subtest_results

    executor_cls.convert_result = convert_result
    return executor_cls


@_evaluate_leaks
class ChromeDriverCrashTestExecutor(WebDriverCrashtestExecutor):
    protocol_cls = ChromeDriverProtocol


@_evaluate_leaks
class ChromeDriverRefTestExecutor(WebDriverRefTestExecutor, _SanitizerMixin):  # type: ignore
    protocol_cls = ChromeDriverProtocol


@_evaluate_leaks
class ChromeDriverTestharnessExecutor(WebDriverTestharnessExecutor, _SanitizerMixin):  # type: ignore
    protocol_cls = ChromeDriverProtocol

    def __init__(self, *args, reuse_window=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.protocol.reuse_window = reuse_window

    def setup(self, runner, protocol=None):
        super().setup(runner, protocol)
        # Chromium requires the `background-sync` permission for reporting APIs
        # to work. Not all embedders (notably, `chrome --headless=old`) grant
        # `background-sync` by default, so this CDP call ensures the permission
        # is granted for all origins, in line with the background sync spec's
        # recommendation [0].
        #
        # WebDriver's "Set Permission" command can only act on the test's
        # origin, which may be too limited.
        #
        # [0]: https://wicg.github.io/background-sync/spec/#permission
        params = {
            "permission": {"name": "background-sync"},
            "setting": "granted",
        }
        self.protocol.cdp.execute_cdp_command("Browser.setPermission", params)


@_evaluate_leaks
class ChromeDriverPrintRefTestExecutor(ChromeDriverRefTestExecutor):
    protocol_cls = ChromeDriverProtocol
    is_print = True

    def setup(self, runner, protocol=None):
        super().setup(runner, protocol)
        self.protocol.pdf_print.load_runner()
        self.has_window = False
        with open(os.path.join(here, "reftest.js")) as f:
            self.script = f.read()

    def screenshot(self, test, viewport_size, dpi, page_ranges):
        # https://github.com/web-platform-tests/wpt/issues/7140
        assert dpi is None

        if not self.has_window:
            self.protocol.base.execute_script(self.script)
            self.protocol.base.set_window(self.protocol.webdriver.handles[-1])
            self.has_window = True

        self.viewport_size = viewport_size
        self.page_ranges = page_ranges.get(test.url)
        timeout = self.timeout_multiplier * test.timeout if self.debug_info is None else None

        test_url = self.test_url(test)

        return WebDriverRun(self.logger,
                            self._render,
                            self.protocol,
                            test_url,
                            timeout,
                            self.extra_timeout).run()

    def _render(self, protocol, url, timeout):
        protocol.webdriver.url = url

        protocol.base.execute_script(self.wait_script, asynchronous=True)

        pdf = protocol.pdf_print.render_as_pdf(*self.viewport_size)
        screenshots = protocol.pdf_print.pdf_to_png(pdf, self.page_ranges)
        for i, screenshot in enumerate(screenshots):
            # strip off the data:img/png, part of the url
            if screenshot.startswith("data:image/png;base64,"):
                screenshots[i] = screenshot.split(",", 1)[1]

        return screenshots
