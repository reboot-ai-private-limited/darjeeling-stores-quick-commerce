import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { findCategory, getCategories, getProducts, defaultVariant, type Category, type Product } from "../../api/catalog";
import { CartBar, ProductCard } from "../../components/shop";
import { Button, Chip, Header, Icon, Press, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

type Sort = "relevance" | "low" | "high" | "discount";
const SORTS: { key: Sort; label: string }[] = [{ key: "relevance", label: "Relevance" }, { key: "low", label: "Price: low to high" }, { key: "high", label: "Price: high to low" }, { key: "discount", label: "Discount" }];

/** Screen 12: products of one category. Sub-category chips on top, sort and in-stock filter, 3-column grid, loads more as you scroll. */
export default function CategoryProducts() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { zone } = useStore();
  const [tree, setTree] = useState<Category[]>([]);
  const [sub, setSub] = useState<string | null>(null); // selected sub-category, null = all
  const [items, setItems] = useState<Product[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("relevance");
  const [inStock, setInStock] = useState(false);
  const [food, setFood] = useState<"veg" | "non_veg" | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [under, setUnder] = useState<number | null>(null);
  const zoneId = zone?.id;

  useEffect(() => { if (zoneId) void getCategories(zoneId).then(setTree).catch(() => undefined); }, [zoneId]);
  const cat = useMemo(() => findCategory(tree, id), [tree, id]);
  const target = sub ?? id;

  const load = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true); setError(null);
    try { const r = await getProducts(zoneId, target); setItems(r.items); setNext(r.nextCursor); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load products."); }
    finally { setLoading(false); }
  }, [zoneId, target]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!zoneId || !next || more) return;
    setMore(true);
    try { const r = await getProducts(zoneId, target, next); setItems(p => [...p, ...r.items]); setNext(r.nextCursor); }
    catch { /* keep what we have; scrolling again retries */ }
    finally { setMore(false); }
  };

  const shown = useMemo(() => {
    let list = inStock ? items.filter(p => p.availability === "in_stock") : items;
    if (food === "veg") list = list.filter(p => p.foodType === "veg" || p.foodType === "vegan");
    if (food === "non_veg") list = list.filter(p => p.foodType === "non_veg" || p.foodType === "egg");
    if (brand) list = list.filter(p => p.brand?.id === brand);
    if (under) list = list.filter(p => (defaultVariant(p)?.price ?? 0) <= under * 100);
    const price = (p: Product) => defaultVariant(p)?.price ?? 0;
    const off = (p: Product) => defaultVariant(p)?.discountPercent ?? 0;
    if (sort === "low") list = [...list].sort((a, b) => price(a) - price(b));
    else if (sort === "high") list = [...list].sort((a, b) => price(b) - price(a));
    else if (sort === "discount") list = [...list].sort((a, b) => off(b) - off(a));
    return list;
  }, [items, sort, inStock, food, brand, under]);
  const hasFood = useMemo(() => items.some(p => p.foodType === "veg" || p.foodType === "vegan" || p.foodType === "non_veg" || p.foodType === "egg"), [items]);
  const brands = useMemo(() => { const m = new Map<string, string>(); items.forEach(p => { if (p.brand) m.set(p.brand.id, p.brand.name); }); return [...m.entries()]; }, [items]);
  const filtered = inStock || !!food || !!brand || !!under;

  const children = cat?.children ?? [];
  const cycleSort = () => setSort(s => SORTS[(SORTS.findIndex(x => x.key === s) + 1) % SORTS.length]!.key);

  return (
    <View style={{ flex: 1 }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}>
          <Header title={cat?.name ?? name ?? "Products"} right={<Press onPress={() => router.push("/search")} haptic style={s.iconBtn}><Icon name="search" size={20} /></Press>} />
        </View>

        {children.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.chips}>
            <Chip label="All" active={sub === null} onPress={() => setSub(null)} />
            {children.map(c => <Chip key={c.id} label={c.name} active={sub === c.id} onPress={() => setSub(c.id)} />)}
          </ScrollView>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[s.chips, { paddingTop: children.length ? 0 : space.sm }]}>
          <Chip label={SORTS.find(x => x.key === sort)!.label} icon="sliders" active={sort !== "relevance"} onPress={cycleSort} />
          <Chip label="In stock" icon="check" active={inStock} onPress={() => setInStock(v => !v)} />
          {hasFood && <Chip label="Veg" active={food === "veg"} onPress={() => setFood(f => (f === "veg" ? null : "veg"))} />}
          {hasFood && <Chip label="Non-veg" active={food === "non_veg"} onPress={() => setFood(f => (f === "non_veg" ? null : "non_veg"))} />}
          {[99, 199, 499].map(u => <Chip key={u} label={`Under ₹${u}`} active={under === u} onPress={() => setUnder(c => (c === u ? null : u))} />)}
          {brands.length > 1 && brands.map(([bid, bn]) => <Chip key={bid} label={bn} icon="tag" active={brand === bid} onPress={() => setBrand(c => (c === bid ? null : bid))} />)}
        </ScrollView>

        {loading && <ActivityIndicator color={colors.maroon} style={{ marginTop: 60 }} />}
        {error && !loading && (
          <View style={{ alignItems: "center", gap: space.md, marginTop: 60 }}>
            <Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} />
          </View>
        )}
        {!loading && !error && shown.length === 0 && (
          <View style={{ alignItems: "center", gap: space.sm, marginTop: 70 }}>
            <Icon name="package" size={40} color={colors.faint} />
            <Text style={type.h2}>Nothing here yet</Text>
            <Text style={type.small}>{filtered ? "No products match these filters. Try removing one." : "This shelf is empty right now."}</Text>
          </View>
        )}
        {!loading && !error && (
          <FlatList
            data={shown} numColumns={3} keyExtractor={p => p.id} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            onEndReached={() => void loadMore()} onEndReachedThreshold={0.6}
            ListFooterComponent={more ? <ActivityIndicator color={colors.maroon} /> : undefined}
            renderItem={({ item }) => <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View>}
          />
        )}
      </Screen>
      <CartBar />
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
});
