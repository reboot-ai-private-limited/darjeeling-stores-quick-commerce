import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { isActiveStatus, listOrders, statusInfo, type OrderSummary } from "../../api/orders";
import { Button, Chip, Icon, Pill, Press, Screen } from "../../components/ui";
import { useStore } from "../../state/store";
import { colors, radius, rupees, shadow, space, type } from "../../theme";

type Tab = "active" | "past";
export const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Screen 26: Active and Past orders. Active orders refresh by themselves every 20 seconds while this tab is open. */
export default function Orders() {
  const { signedIn } = useStore();
  const [tab, setTab] = useState<Tab>("active");
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;

  const load = useCallback(async (which: Tab, pull = false) => {
    if (!signedIn) return;
    if (pull) setRefreshing(true);
    try {
      const r = await listOrders(which);
      if (tabRef.current !== which) return;
      setItems(r.items); setNext(r.nextCursor); setError(null);
    } catch (e) { if (tabRef.current === which) setError(e instanceof Error ? e.message : "Couldn't load your orders."); }
    finally { setRefreshing(false); }
  }, [signedIn]);

  useFocusEffect(useCallback(() => {
    void load(tab);
    const t = tab === "active" ? setInterval(() => void load("active"), 20000) : null;
    return () => { if (t) clearInterval(t); };
  }, [load, tab]));

  const switchTab = (t: Tab) => { if (t === tab) return; setTab(t); setItems(null); setNext(null); setError(null); };
  const loadMore = async () => {
    if (!next || more) return;
    setMore(true);
    try { const r = await listOrders(tab, next); setItems(p => [...(p ?? []), ...r.items]); setNext(r.nextCursor); } catch { /* try again on next scroll */ }
    finally { setMore(false); }
  };

  return (
    <Screen pad={false} bottomPad={0}>
      <Text style={[type.title, { paddingHorizontal: space.lg, paddingTop: space.lg }]}>Your orders</Text>
      {!signedIn ? (
        <View style={s.center}>
          <Icon name="shopping-bag" size={48} color={colors.faint} />
          <Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>Sign in to see your orders.</Text>
          <Button label="Sign in" onPress={() => router.push("/login")} />
        </View>
      ) : (
        <>
          <View style={s.tabs}><Chip label="Active" active={tab === "active"} onPress={() => switchTab("active")} /><Chip label="Past" active={tab === "past"} onPress={() => switchTab("past")} /></View>
          {error && !items ? (
            <View style={s.center}><Icon name="wifi-off" size={36} color={colors.faint} /><Text style={type.small}>{error}</Text><Button label="Try again" variant="soft" onPress={() => void load(tab)} /></View>
          ) : !items ? (
            <ActivityIndicator color={colors.maroon} style={{ marginTop: 80 }} />
          ) : (
            <FlatList
              data={items} keyExtractor={o => o.groupId} showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 190, gap: space.md, flexGrow: 1 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(tab, true)} tintColor={colors.maroon} colors={[colors.maroon]} />}
              onEndReached={() => void loadMore()} onEndReachedThreshold={0.5}
              ListEmptyComponent={
                <View style={s.center}>
                  <View style={s.emptyIcon}><Icon name="shopping-bag" size={40} color={colors.maroon} /></View>
                  <Text style={type.h2}>{tab === "active" ? "No active orders" : "No past orders yet"}</Text>
                  <Text style={[type.small, { textAlign: "center" }]}>{tab === "active" ? "Orders on their way will show up here." : "Delivered orders will be listed here."}</Text>
                  {tab === "active" && <Button label="Start shopping" variant="soft" onPress={() => router.navigate("/home")} />}
                </View>
              }
              ListFooterComponent={more ? <ActivityIndicator color={colors.maroon} /> : undefined}
              renderItem={({ item }) => <OrderCard o={item} />}
            />
          )}
        </>
      )}
    </Screen>
  );
}

function OrderCard({ o }: { o: OrderSummary }) {
  const info = statusInfo(o.status);
  const count = o.children.reduce((n, c) => n + c.itemCount, 0);
  const live = isActiveStatus(o.status);
  const promised = live ? o.children.map(c => c.promisedAt).filter(Boolean).sort().at(-1) : null;
  return (
    <Press onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.groupId } })}>
      <View style={s.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.h2, { flex: 1 }]}>{o.groupNo}</Text>
          <Pill label={info.label.toUpperCase()} tone={info.tone} />
        </View>
        <Text style={type.small}>{when(o.createdAt)} · {count} {count === 1 ? "item" : "items"}</Text>
        {promised && <Text style={s.arrive}>Arriving by {new Date(promised).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Text>}
        {o.children.length > 1 && o.children.map(c => <Text key={c.id} style={type.small}>{c.orderNo}: {statusInfo(c.status).label}</Text>)}
        <View style={s.foot}><Text style={[type.body, { fontWeight: "900", flex: 1 }]}>{rupees(o.total)}</Text><Text style={s.link}>View details</Text><Icon name="chevron-right" size={16} color={colors.maroon} /></View>
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: 60 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.yellowSoft, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: space.lg, gap: 4, ...shadow.card },
  arrive: { fontSize: 13, fontWeight: "800", color: colors.maroon },
  foot: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  link: { fontSize: 13, fontWeight: "800", color: colors.maroon },
});
