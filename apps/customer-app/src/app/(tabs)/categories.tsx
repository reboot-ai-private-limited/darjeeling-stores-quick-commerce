import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { categoryPictures, cachedCategories, getCategories, getHome, type Category } from "../../api/catalog";
import { CategoryGridSkeleton } from "../../components/Skeleton";
import { CategoryTile } from "../../components/shop";
import { Button, Icon, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, space, type } from "../../theme";

/** Screen 11 (first version): every category in the zone, with its sub-categories listed beneath. Tapping opens the products list in the next step. */
export default function Categories() {
  const { zone } = useStore();
  // Show the last list at once if we have it; the fresh one replaces it quietly.
  const [cats, setCats] = useState<Category[] | null>(() => { const c = cachedCategories(zone?.id); return c.length > 0 ? c : null; });
  const [pics, setPics] = useState<ReturnType<typeof categoryPictures>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!zone) return;
    setError(null);
    try {
      const [list, home] = await Promise.all([getCategories(zone.id), getHome(zone.id).catch(() => null)]);
      setCats(list); setPics(categoryPictures(list, home?.sections ?? []));
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load categories."); }
  }, [zone]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Screen pad={false} bottomPad={0}>
      <Text style={[type.title, { paddingHorizontal: space.lg, paddingTop: space.lg }]}>All categories</Text>
      {error && <View style={{ alignItems: "center", gap: space.md, marginTop: 60 }}><Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load()} /></View>}
      {!cats && !error && <CategoryGridSkeleton />}
      <ScrollView contentContainerStyle={{ padding: space.sm, paddingBottom: 190 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{cats?.map((c, i) => <CategoryTile key={c.id} category={c} picture={pics[c.id]} tint={i} />)}</View>
        {cats?.length === 0 && <Text style={[type.body, { textAlign: "center", color: colors.muted, marginTop: 60 }]}>No categories yet.</Text>}
      </ScrollView>
    </Screen>
  );
}
