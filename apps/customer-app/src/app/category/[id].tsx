import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { cachedCategories, findCategory, getCategories, getProducts, defaultVariant, type Category, type Product } from "../../api/catalog";
import { GridSkeleton } from "../../components/Skeleton";
import { Dropdown } from "../../components/Dropdown";
import { fillRow, CartBar, GlassScene, ProductCard } from "../../components/shop";
import { Button, Chip, Header, Icon, Press, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

type Sort = "relevance" | "low" | "high" | "discount";
const SORTS: { key: Sort; label: string }[] = [{ key: "relevance", label: "Relevance" }, { key: "low", label: "Price: low to high" }, { key: "high", label: "Price: high to low" }, { key: "discount", label: "Discount" }];

/** Screen 12: products of one category. Sub-category chips on top, sort and in-stock filter, 3-column grid, loads more as you scroll. */
export default function CategoryProducts() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { zone } = useStore();
  const [tree, setTree] = useState<Category[]>(() => cachedCategories(zone?.id));
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
  const cols = children.length > 0 ? 2 : 3; // the left rail takes room, so two cards fit beside it

  return (
    <GlassScene bar={<CartBar />}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}>
          <Header title={cat?.name ?? name ?? "Products"} right={<Press onPress={() => router.push("/search")} haptic style={s.iconBtn}><Icon name="search" size={20} /></Press>} />
        </View>

        <View style={{ flex: 1, flexDirection: "row" }}>
          {children.length > 0 && (
            <ScrollView showsVerticalScrollIndicator={false} style={s.rail} contentContainerStyle={{ paddingBottom: 140 }}>
              {[{ id: null as string | null, name: "All", imageUrl: cat?.imageUrl ?? null }, ...children.map(c => ({ id: c.id as string | null, name: c.name, imageUrl: c.imageUrl }))].map(c => {
                const on = sub === c.id;
                return (
                  <Press key={c.id ?? "all"} onPress={() => setSub(c.id)} style={[s.railItem, on && s.railOn]}>
                    <View style={[s.railImg, on && { borderColor: colors.maroon }]}>
                      {c.imageUrl ? <Image source={{ uri: c.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : <Icon name="grid" size={22} color={colors.maroon} />}
                    </View>
                    <Text style={[s.railText, on && { color: colors.maroon, fontWeight: "900" }]} numberOfLines={2}>{c.name}</Text>
                  </Press>
                );
              })}
            </ScrollView>
          )}
          <View style={{ flex: 1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[s.chips, { paddingTop: children.length ? 0 : space.sm }]}>
          <Dropdown title="Sort by" label="Sort" value={sort === "relevance" ? null : sort} options={SORTS.filter(x => x.key !== "relevance").map(x => ({ value: x.key, label: x.label }))} onChange={v => setSort(v ?? "relevance")} />
          <Dropdown title="Price" label="Price" value={under} options={[99, 199, 499].map(u => ({ value: u, label: `Under ₹${u}` }))} onChange={setUnder} />
          {hasFood && <Dropdown title="Food type" label="Type" value={food} options={[{ value: "veg", label: "Veg" }, { value: "non_veg", label: "Non-veg" }]} onChange={v => setFood(v as "veg" | "non_veg" | null)} />}
          {brands.length > 1 && <Dropdown title="Brand" label="Brand" value={brand} options={brands.map(([bid, bn]) => ({ value: bid, label: bn }))} onChange={setBrand} />}
          <Chip label="In stock" icon="check" active={inStock} onPress={() => setInStock(v => !v)} />
        </ScrollView>

        {loading && <GridSkeleton cols={cols} />}
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
            data={fillRow(shown, cols)} numColumns={cols} key={cols} keyExtractor={(p, i) => p?.id ?? `fill${i}`} showsVerticalScrollIndicator={false}
            columnWrapperStyle={{ gap: space.sm, paddingHorizontal: children.length > 0 ? space.sm : space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md, paddingBottom: 140 }}
            onEndReached={() => void loadMore()} onEndReachedThreshold={0.6}
            ListFooterComponent={more ? <ActivityIndicator color={colors.maroon} /> : undefined}
            renderItem={({ item }) => item ? <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View> : <View style={{ flex: 1 }} />}
          />
        )}
          </View>
        </View>
      </Screen>
    </GlassScene>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  rail: { width: 86, flexGrow: 0, backgroundColor: colors.white, borderRightWidth: 1, borderRightColor: colors.line },
  railItem: { alignItems: "center", paddingVertical: space.md, paddingHorizontal: 4, borderLeftWidth: 4, borderLeftColor: "transparent" },
  railOn: { backgroundColor: colors.cream, borderLeftColor: colors.maroon },
  railImg: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", backgroundColor: colors.creamDeep, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  railText: { marginTop: 6, fontSize: 11, fontWeight: "700", color: colors.ink, textAlign: "center", lineHeight: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
});
