import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { searchProducts, type Product } from "../api/catalog";
import { Header, Icon, Screen } from "../components/ui";
import { CartBar, ProductCard } from "../components/shop";
import { useStore } from "../state/store";
import { colors, radius, shadow, space, type } from "../theme";

/** Screen 9: instant search. Waits 250 ms after typing stops, and ignores answers that arrive late. */
export default function Search() {
  const { zone } = useStore();
  const params = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(params.q ?? "");
  const [results, setResults] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const term = q.trim();

  useEffect(() => {
    if (!zone || term.length < 2) { setResults(null); setError(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try { const r = await searchProducts(zone.id, term); if (live) { setResults(r); setError(null); } }
      catch (e) { if (live) setError(e instanceof Error ? e.message : "Search failed."); }
      finally { if (live) setBusy(false); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [term, zone]);

  return (
    <View style={{ flex: 1 }}>
      <Screen pad={false} bottomPad={0}>
        <View style={{ paddingHorizontal: space.lg }}><Header title="Search" /></View>
        <View style={s.field}>
          <Icon name="search" size={20} color={colors.muted} />
          <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search for tea, snacks, spices…" placeholderTextColor={colors.faint} style={s.input} returnKeyType="search" accessibilityLabel="Search" />
          {busy ? <ActivityIndicator color={colors.maroon} /> : q ? <Icon name="x" size={18} color={colors.muted} /> : null}
        </View>
        {error && <Text style={[type.small, { color: colors.red, textAlign: "center", marginTop: space.lg }]}>{error}</Text>}
        {results?.length === 0 && !busy && (
          <View style={{ alignItems: "center", gap: space.sm, marginTop: 70 }}>
            <Icon name="search" size={40} color={colors.faint} />
            <Text style={type.h2}>No results for "{term}"</Text>
            <Text style={[type.small, { textAlign: "center" }]}>Check the spelling or try a shorter word.</Text>
          </View>
        )}
        {!results && !error && <Text style={[type.small, { textAlign: "center", marginTop: 60 }]}>Type at least 2 letters to search.</Text>}
        <FlatList
          data={results ?? []} numColumns={2} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled"
          columnWrapperStyle={{ gap: space.md, paddingHorizontal: space.lg }} contentContainerStyle={{ gap: space.md, paddingTop: space.lg, paddingBottom: 120 }}
          renderItem={({ item }) => <View style={{ flex: 1 }}><ProductCard product={item} width="100%" /></View>}
        />
      </Screen>
      <CartBar />
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: space.sm, height: 52, marginHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.white, paddingHorizontal: space.lg, ...shadow.card },
  input: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink, outlineStyle: "none" as never },
});
