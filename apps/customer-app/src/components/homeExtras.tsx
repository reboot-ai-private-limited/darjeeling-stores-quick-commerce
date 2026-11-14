import { Image } from "expo-image";
import { useFocusEffect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { cachedBrands, defaultVariant, getBrands, type BrandInfo, type Product } from "../api/catalog";
import { kv } from "../api/kv";
import { liftIn } from "../motion";
import { colors, radius, rupees, SECTION_GAP, shadow, space, TITLE_GAP, type } from "../theme";
import { SectionHead } from "./home";
import { ProductCard } from "./shop";
import { Icon, Press, type IconName } from "./ui";

/** Every product on the home shelves once, newest shelf first. */
export const uniqueProducts = (sections: { products: Product[] }[]): Product[] => {
  const seen = new Set<string>(); const out: Product[] = [];
  for (const s of sections) for (const p of s.products) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
};

const price = (p: Product) => defaultVariant(p)?.price ?? 0;
const off = (p: Product) => defaultVariant(p)?.discountPercent ?? 0;

function Rail({ title, products, eta, onSeeAll }: { title: string; products: Product[]; eta?: string; onSeeAll?: () => void }) {
  if (products.length === 0) return null;
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <SectionHead title={title} onSeeAll={onSeeAll} />
      <FlatList
        horizontal data={products} keyExtractor={p => p.id} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: TITLE_GAP, gap: space.md }}
        renderItem={({ item }) => <ProductCard product={item} eta={eta} />}
      />
    </View>
  );
}

const TRUST: { icon: IconName; title: string; sub: string }[] = [
  { icon: "zap", title: "Fast delivery", sub: "At your door in minutes" },
  { icon: "feather", title: "Fresh & local", sub: "Straight from Darjeeling" },
  { icon: "credit-card", title: "Pay your way", sub: "Cash, UPI or card" },
];
/** Three reasons to shop here, as a quick scannable strip. */
export function TrustStrip() {
  return (
    <View style={s.trust}>
      {TRUST.map(t => (
        <View key={t.title} style={{ flex: 1, alignItems: "center", gap: 4 }}>
          <View style={s.trustIcon}><Icon name={t.icon} size={18} color={colors.maroon} /></View>
          <Text style={s.trustTitle}>{t.title}</Text>
          <Text style={s.trustSub} numberOfLines={2}>{t.sub}</Text>
        </View>
      ))}
    </View>
  );
}

/** Biggest discounts first, with a bold "% OFF" headline. */
export function DealsRail({ products, eta }: { products: Product[]; eta?: string }) {
  const deals = useMemo(() => products.filter(p => off(p) > 0 && p.availability === "in_stock").sort((a, b) => off(b) - off(a)).slice(0, 12), [products]);
  if (deals.length === 0) return null;
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <View style={s.dealHead}>
        <View style={s.dealTag}><Icon name="zap" size={14} color={colors.maroon} /><Text style={s.dealTagText}>DEALS OF THE DAY</Text></View>
        <Text style={s.dealTitle}>Up to {off(deals[0]!)}% off</Text>
      </View>
      <FlatList
        horizontal data={deals} keyExtractor={p => p.id} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: TITLE_GAP, gap: space.md }}
        renderItem={({ item }) => <ProductCard product={item} eta={eta} />}
      />
    </View>
  );
}

/** Price bands in rupees. Each product belongs to exactly one, so the chips never show the same shelf twice. */
const BANDS = [
  { label: "Under ₹49", min: 0, max: 49 },
  { label: "₹50 – ₹99", min: 50, max: 99 },
  { label: "₹100 – ₹199", min: 100, max: 199 },
];
/** Price-band chips that switch the shelf below them. Bands with nothing in stock are left out, and the best deals come first. */
export function BudgetRail({ products, eta }: { products: Product[]; eta?: string }) {
  const [picked, setPicked] = useState(0);
  const bands = useMemo(() => BANDS.map(b => ({
    ...b,
    items: products
      // Prices are in paise: ₹49.50 still counts as "under ₹50", so a band runs from min to just under max + 1 rupee.
      .filter(p => p.availability === "in_stock" && price(p) > 0 && price(p) >= b.min * 100 && price(p) < (b.max + 1) * 100)
      .sort((a, c) => off(c) - off(a) || price(a) - price(c))
      .slice(0, 14),
  })).filter(b => b.items.length > 0), [products]);
  if (bands.length === 0) return null;
  // If the chosen band has since emptied (the shelves refreshed), fall back to the first one that has products.
  const active = bands[Math.min(picked, bands.length - 1)]!;
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <SectionHead title="Pocket-friendly picks" />
      {bands.length > 1 && (
        <View style={s.chips}>
          {bands.map((b, i) => (
            <Press key={b.label} haptic onPress={() => setPicked(i)} style={[s.chip, active === b && s.chipOn]}>
              <Text style={[s.chipText, active === b && { color: colors.white }]}>{b.label}</Text>
            </Press>
          ))}
        </View>
      )}
      <FlatList
        key={active.label} horizontal data={active.items} keyExtractor={p => p.id} showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: TITLE_GAP, gap: space.md }}
        renderItem={({ item }) => <ProductCard product={item} eta={eta} />}
      />
    </View>
  );
}

/** Brand bubbles with each brand's logo (its first letter when it has none). Tapping one opens the brand's products. */
export function BrandRow({ products, zoneId }: { products: Product[]; zoneId?: string | undefined }) {
  const [listed, setListed] = useState<BrandInfo[]>(() => cachedBrands(zoneId));
  useEffect(() => { if (zoneId) void getBrands(zoneId).then(setListed).catch(() => undefined); }, [zoneId]);
  const brands = useMemo(() => {
    // The zone's own brand list (with logos) when we have it; otherwise the brands found on the shelves.
    if (listed.length > 0) return [...listed].sort((a, b) => b.productCount - a.productCount).slice(0, 12).map((b): [string, { name: string; logoUrl: string | null }] => [b.id, { name: b.name, logoUrl: b.logoUrl }]);
    const m = new Map<string, { name: string; count: number }>();
    for (const p of products) if (p.brand) { const e = m.get(p.brand.id) ?? { name: p.brand.name, count: 0 }; e.count++; m.set(p.brand.id, e); }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12).map(([id, e]): [string, { name: string; logoUrl: string | null }] => [id, { name: e.name, logoUrl: null }]);
  }, [products, listed]);
  if (brands.length < 2) return null;
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <SectionHead title="Shop by brand" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: TITLE_GAP, gap: space.md }}>
        {brands.map(([id, b], i) => (
          <Animated.View key={id} entering={liftIn(i * 40)}>
            <Press haptic onPress={() => router.push({ pathname: "/brand/[id]", params: { id, name: b.name } })} style={{ alignItems: "center", width: 76, gap: 6 }}>
              <View style={s.brand}>{b.logoUrl ? <Image source={{ uri: b.logoUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} /> : <Text style={s.brandLetter}>{b.name.slice(0, 1).toUpperCase()}</Text>}</View>
              <Text style={s.brandName} numberOfLines={1}>{b.name}</Text>
            </Press>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const BADGE_TITLE: Record<string, string> = { bestseller: "Bestsellers", new: "New launches", organic: "Organic picks", trending: "Trending now" };
/** One shelf for each product badge the store uses (Bestseller, New, Organic…). */
export function BadgeRails({ products, eta }: { products: Product[]; eta?: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) if (p.badge) m.set(p.badge, [...(m.get(p.badge) ?? []), p]);
    return [...m.entries()].filter(([, l]) => l.length >= 2).slice(0, 3);
  }, [products]);
  return <>{groups.map(([badge, list]) => <Rail key={badge} title={BADGE_TITLE[badge] ?? badge.replace(/_/g, " ").replace(/^./, c => c.toUpperCase())} products={list.slice(0, 12)} eta={eta} />)}</>;
}

const RECENT_KEY = "customer.recent";
/** Remembers the products a customer opened, newest first (at most 10). */
export const rememberViewed = async (p: Product) => {
  try {
    const cur: Product[] = JSON.parse((await kv.get(RECENT_KEY)) ?? "[]");
    await kv.set(RECENT_KEY, JSON.stringify([p, ...cur.filter(x => x.id !== p.id)].slice(0, 10)));
  } catch { /* a missing history is fine */ }
};
/** The products the customer looked at recently. */
export function RecentlyViewed({ eta }: { eta?: string }) {
  const [list, setList] = useState<Product[]>([]);
  useFocusEffect(useCallback(() => { void kv.get(RECENT_KEY).then(v => setList(v ? (JSON.parse(v) as Product[]) : [])).catch(() => setList([])); }, []));
  return <Rail title="Recently viewed" products={list} eta={eta} />;
}

const POPULAR = ["Darjeeling tea", "Biscuits", "Spices", "Momos", "Honey", "Gift box"];
/** Quick searches. */
export function PopularSearches() {
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <SectionHead title="Popular searches" />
      <View style={[s.chips, { flexWrap: "wrap" }]}>
        {POPULAR.map(q => (
          <Press key={q} haptic onPress={() => router.push({ pathname: "/search", params: { q } })} style={s.chip}>
            <Icon name="search" size={13} color={colors.muted} /><Text style={s.chipText}>{q}</Text>
          </Press>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  trust: { flexDirection: "row", gap: space.sm, marginHorizontal: space.lg, marginTop: space.lg, padding: space.md, backgroundColor: colors.white, borderRadius: radius.lg, ...shadow.card },
  trustIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  trustTitle: { fontSize: 12, fontWeight: "900", color: colors.ink, textAlign: "center" },
  trustSub: { fontSize: 10, color: colors.muted, textAlign: "center", lineHeight: 13 },
  dealHead: { marginHorizontal: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.yellow, gap: 4 },
  dealTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  dealTagText: { fontSize: 11, fontWeight: "900", color: colors.maroon, letterSpacing: 1 },
  dealTitle: { fontSize: 24, fontWeight: "900", letterSpacing: -0.6, color: colors.maroon },
  chips: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: TITLE_GAP },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  chipText: { fontSize: 13, fontWeight: "800", color: colors.ink },
  brand: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.yellowSoft, borderWidth: 1.5, borderColor: colors.yellow, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  brandLetter: { fontSize: 24, fontWeight: "900", color: colors.maroon },
  brandName: { fontSize: 12, fontWeight: "700", color: colors.ink },
});
