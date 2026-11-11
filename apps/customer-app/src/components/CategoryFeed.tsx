import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { cardImage, getProducts, type Category, type Product } from "../api/catalog";
import { liftIn } from "../motion";
import { colors, space, type } from "../theme";
import { SectionHead } from "./home";
import { CategoryTile, ProductCard } from "./shop";
import { Icon } from "./ui";

type Shelf = { cat: Category; products: Product[] };

/**
 * What the home page shows once a category tab is picked (like Blinkit): the sub-categories as tiles,
 * then a shelf of products for each one. A category with no sub-categories shows its products as a grid.
 */
export function CategoryFeed({ category, zoneId, eta }: { category: Category; zoneId: string; eta?: string }) {
  const children = category.children ?? [];
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [grid, setGrid] = useState<Product[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setShelves(null); setGrid(null); setError(false);
    const run = async () => {
      try {
        if (children.length > 0) {
          const list = await Promise.all(children.slice(0, 10).map(c => getProducts(zoneId, c.id).then(r => ({ cat: c, products: r.items.slice(0, 10) })).catch(() => ({ cat: c, products: [] as Product[] }))));
          if (live) setShelves(list);
        } else {
          const r = await getProducts(zoneId, category.id);
          if (live) setGrid(r.items);
        }
      } catch { if (live) setError(true); }
    };
    void run();
    return () => { live = false; };
  }, [category.id, zoneId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A tile picture for each sub-category: its own image, or the first product photo on its shelf. */
  const pics = useMemo(() => {
    const out: Record<string, { uri: string; product: boolean }> = {};
    for (const c of children) {
      if (c.imageUrl) { out[c.id] = { uri: c.imageUrl, product: false }; continue; }
      const u = shelves?.find(s => s.cat.id === c.id)?.products.map(cardImage).find((x): x is string => !!x);
      if (u) out[c.id] = { uri: u, product: true };
    }
    return out;
  }, [children, shelves]);

  if (error) return <View style={{ alignItems: "center", gap: space.sm, marginTop: 60 }}><Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>Couldn't load this category.</Text></View>;
  if (!shelves && !grid) return <ActivityIndicator color={colors.maroon} style={{ marginTop: 70 }} />;

  const open = (c: Category) => router.push({ pathname: "/category/[id]", params: { id: c.id, name: c.name } });

  if (grid) {
    return (
      <View style={{ marginTop: space.lg }}>
        <SectionHead title={category.name} />
        {grid.length === 0 && <Text style={[type.body, { textAlign: "center", color: colors.muted, marginTop: 50 }]}>Nothing here yet.</Text>}
        <FlatList
          data={grid} numColumns={3} scrollEnabled={false} keyExtractor={p => p.id}
          columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.xl, paddingTop: space.md }}
          renderItem={({ item, index }) => <Animated.View entering={liftIn((index % 9) * 30)} style={{ flex: 1 }}><ProductCard product={item} width="100%" eta={eta} /></Animated.View>}
        />
      </View>
    );
  }

  return (
    <View>
      <View style={{ paddingHorizontal: space.sm, marginTop: space.lg }}>
        <Text style={[type.h2, { paddingHorizontal: space.md }]}>{category.name}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space.md }}>
          {children.map((c, i) => <CategoryTile key={c.id} category={c} picture={pics[c.id]} tint={i} onPress={() => open(c)} />)}
        </View>
      </View>
      {shelves?.filter(s => s.products.length > 0).map(s => (
        <View key={s.cat.id} style={{ marginTop: space.xl }}>
          <SectionHead title={s.cat.name} onSeeAll={() => open(s.cat)} />
          <FlatList
            horizontal data={s.products} keyExtractor={p => p.id} showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md }}
            renderItem={({ item }) => <ProductCard product={item} eta={eta} />}
          />
        </View>
      ))}
    </View>
  );
}
