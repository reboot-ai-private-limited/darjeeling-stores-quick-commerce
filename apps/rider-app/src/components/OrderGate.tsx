import { Text, View } from "react-native";
import { colors, type } from "../theme";
import { Button, Header, Screen } from "./ui";

/** Shown by the order screens while the order is loading, or when it could not be loaded. */
export function OrderGate({ title, loading, error, onRetry }: { title: string; loading: boolean; error: string; onRetry: () => void }) {
  return (
    <Screen>
      <Header title={title} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 20 }}>
        {loading ? <Text style={type.small}>Loading the order…</Text> : (
          <>
            <Text style={{ color: colors.red, fontWeight: "700", textAlign: "center" }}>{error || "This order is no longer active."}</Text>
            <Button label="Try again" variant="soft" onPress={onRetry} />
          </>
        )}
      </View>
    </Screen>
  );
}
