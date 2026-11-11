import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { searchProducts, type Product } from "../../api/catalog";
import { CartBar, ProductCard } from "../../components/shop";
import { Header, Icon, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

/** Screen 13: all of one brand's products in the store. */
export default function Brand() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { zone } = useStore();
  const [items, setItems] = useState<Product[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!zone || !name) return;
    void searchProducts(zone.id, name).then(r => setItems(r.filter(p => p.brand?.id === id))).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load this brand."));
  }, [zone, id, name]);
  return (
    <View style={{ flex: 1 }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title={name ?? "Brand"} subtitle={items ? `${items.length} ${items.length === 1 ? "product" : "products"}` : undefined} /></View>
        {!items && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
        {!!err && <Text style={[type.small, { textAlign: "center", marginTop: 60 }]}>{err}</Text>}
        {items?.length === 0 && <View style={{ alignItems: "center", gap: space.sm, marginTop: 70 }}><Icon name="package" size={40} color={colors.faint} /><Text style={type.h2}>Nothing here yet</Text></View>}
        {items && items.length > 0 && (
          <FlatList
            data={items} numColumns={3} keyExtractor={p => p.id} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            renderItem={({ item }) => <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View>}
          />
        )}
      </Screen>
      <CartBar />
    </View>
  );
}
