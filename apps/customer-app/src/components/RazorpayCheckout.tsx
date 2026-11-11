import { WebView } from "react-native-webview";
import { checkoutHtml, type CheckoutData, type RazorpaySuccess } from "../api/payments";

export type CheckoutEvent = { type: "success"; data: RazorpaySuccess } | { type: "failed"; reason: string } | { type: "dismissed" } | { type: "error"; reason: string };

/** Razorpay Standard Checkout inside a WebView (works in Expo Go). UPI apps open through their own intents. */
export function RazorpayCheckout({ data, prefill, onEvent }: { data: CheckoutData; prefill: { name?: string; phone?: string }; onEvent: (e: CheckoutEvent) => void }) {
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: checkoutHtml(data, prefill), baseUrl: "https://checkout.razorpay.com" }}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      onMessage={ev => { try { onEvent(JSON.parse(ev.nativeEvent.data) as CheckoutEvent); } catch { /* ignore noise */ } }}
      onShouldStartLoadWithRequest={req => {
        // Let UPI apps and other app links open outside the WebView.
        if (/^(upi|tez|phonepe|paytmmp|gpay|intent):/i.test(req.url)) { void import("react-native").then(m => m.Linking.openURL(req.url).catch(() => undefined)); return false; }
        return true;
      }}
      style={{ flex: 1, backgroundColor: "#f7f3ea" }}
    />
  );
}
