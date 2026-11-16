import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { cachedBrands, getBrandProducts, getBrands, type Product } from "../../api/catalog";
import { fillRow, CartBar, ProductCard } from "../../components/shop";
import { Header, Icon, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

/** Screen 13: all of one brand's products in the store. */
export default function Brand() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { zone } = useStore();
  const [items, setItems] = useState<Product[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [logo, setLogo] = useState<string | null>(() => cachedBrands(zone?.id).find(b => b.id === id)?.logoUrl ?? null);
  useEffect(() => { if (zone) void getBrands(zone.id).then(list => { const b = list.find(x => x.id === id); setLogo(b?.logoUrl ?? null); setTotal(b?.productCount ?? null); }).catch(() => undefined); }, [zone, id]);
  // The brand's products load 10 at a time; the next ten load when the list is scrolled to its end.
  useEffect(() => {
    if (!zone || !id) return;
    void getBrandProducts(zone.id, id).then(r => { setItems(r.items); setNext(r.nextCursor); }).catch(e => setErr(e instanceof Error ? e.message : "Couldn't load this brand."));
  }, [zone, id]);
  const loadMore = async () => {
    if (!zone || !id || !next || more) return;
    setMore(true);
    try { const r = await getBrandProducts(zone.id, id, next); setItems(p => [...(p ?? []), ...r.items]); setNext(r.nextCursor); }
    catch { /* keep what we have; scrolling again retries */ }
    finally { setMore(false); }
  };
  return (
    <View style={{ flex: 1 }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title={name ?? "Brand"} subtitle={items ? `${total ?? items.length} ${(total ?? items.length) === 1 ? "product" : "products"}` : undefined} right={logo ? <Image source={{ uri: logo }} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.maroon }} contentFit="cover" /> : undefined} /></View>
        {!items && !err && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
        {!!err && <Text style={[type.small, { textAlign: "center", marginTop: 60 }]}>{err}</Text>}
        {items?.length === 0 && <View style={{ alignItems: "center", gap: space.sm, marginTop: 70 }}><Icon name="package" size={40} color={colors.faint} /><Text style={type.h2}>Nothing here yet</Text></View>}
        {items && items.length > 0 && (
          <FlatList
            data={fillRow(items, 3)} numColumns={3} keyExtractor={(p, i) => p?.id ?? `fill${i}`} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            onEndReached={() => void loadMore()} onEndReachedThreshold={0.6}
            ListFooterComponent={more ? <ActivityIndicator color={colors.maroon} /> : undefined}
            renderItem={({ item }) => item ? <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View> : <View style={{ flex: 1 }} />}
          />
        )}
      </Screen>
      <CartBar />
    </View>
  );
}
