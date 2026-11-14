import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { cachedBrands, getBrands, searchProducts, type Product } from "../../api/catalog";
import { fillRow, CartBar, GlassScene, ProductCard } from "../../components/shop";
import { Header, Icon, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

/** Screen 13: all of one brand's products in the store. */
export default function Brand() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { zone } = useStore();
  const [items, setItems] = useState<Product[] | null>(null);
  const [err, setErr] = useState("");
  const [logo, setLogo] = useState<string | null>(() => cachedBrands(zone?.id).find(b => b.id === id)?.logoUrl ?? null);
  useEffect(() => { if (zone) void getBrands(zone.id).then(list => setLogo(list.find(b => b.id === id)?.logoUrl ?? null)).catch(() => undefined); }, [zone, id]);
  useEffect(() => {
    if (!zone || !name) return;
    void searchProducts(zone.id, name).then(r => setItems(r.filter(p => p.brand?.id === id))).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load this brand."));
  }, [zone, id, name]);
  return (
    <GlassScene bar={<CartBar />}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title={name ?? "Brand"} subtitle={items ? `${items.length} ${items.length === 1 ? "product" : "products"}` : undefined} right={logo ? <Image source={{ uri: logo }} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.yellow }} contentFit="cover" /> : undefined} /></View>
        {!items && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
        {!!err && <Text style={[type.small, { textAlign: "center", marginTop: 60 }]}>{err}</Text>}
        {items?.length === 0 && <View style={{ alignItems: "center", gap: space.sm, marginTop: 70 }}><Icon name="package" size={40} color={colors.faint} /><Text style={type.h2}>Nothing here yet</Text></View>}
        {items && items.length > 0 && (
          <FlatList
            data={fillRow(items, 3)} numColumns={3} keyExtractor={(p, i) => p?.id ?? `fill${i}`} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            renderItem={({ item }) => item ? <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View> : <View style={{ flex: 1 }} />}
          />
        )}
      </Screen>
    </GlassScene>
  );
}
