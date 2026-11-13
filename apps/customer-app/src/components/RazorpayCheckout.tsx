import { WebView } from "react-native-webview";
import { checkoutHtml, PAYMENT_RETURN_URL, type CheckoutData, type RazorpaySuccess } from "../api/payments";

export type CheckoutEvent = { type: "success"; data: RazorpaySuccess } | { type: "failed"; reason: string } | { type: "dismissed" } | { type: "returned" } | { type: "error"; reason: string };

/** Razorpay Standard Checkout inside a WebView (works in Expo Go). UPI apps open through their own intents. */
export function RazorpayCheckout({ data, prefill, onEvent }: { data: CheckoutData; prefill: { name?: string; phone?: string }; onEvent: (e: CheckoutEvent) => void }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: checkoutHtml(data, prefill), baseUrl: "https://checkout.razorpay.com" }}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      // The payment ended and Razorpay is sending the customer back: the server tells us the result.
      onNavigationStateChange={nav => { if (nav.url?.startsWith(PAYMENT_RETURN_URL)) onEvent({ type: "returned" }); }}
      onLoadStart={ev => { if (ev.nativeEvent.url?.startsWith(PAYMENT_RETURN_URL)) onEvent({ type: "returned" }); }}
      onError={ev => { if (ev.nativeEvent.url?.startsWith(PAYMENT_RETURN_URL)) onEvent({ type: "returned" }); }}
      onMessage={ev => { try { onEvent(JSON.parse(ev.nativeEvent.data) as CheckoutEvent); } catch { /* ignore noise */ } }}
      onShouldStartLoadWithRequest={req => {
        if (req.url.startsWith(PAYMENT_RETURN_URL)) { onEvent({ type: "returned" }); return false; }
        // Let UPI apps and other app links open outside the WebView.
        if (/^(upi|tez|phonepe|paytmmp|gpay|intent):/i.test(req.url)) { void import("react-native").then(m => m.Linking.openURL(req.url).catch(() => undefined)); return false; }
        return true;
      }}
      style={{ flex: 1, backgroundColor: "#f7f3ea" }}
    />
  );
}
