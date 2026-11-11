import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow, space, type } from "../theme";
import { Icon, Press } from "./ui";

export type Option<T> = { value: T; label: string };

/** A filter button that shows the current choice and opens a list to pick from. Picking the chosen option again clears it when `clearable`. */
export function Dropdown<T extends string | number>({ title, label, value, options, onChange, clearable = true }: { title: string; label: string; value: T | null; options: Option<T>[]; onChange: (v: T | null) => void; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find(o => o.value === value);
  const active = value !== null && chosen !== undefined;
  return (
    <>
      <Press onPress={() => setOpen(true)} haptic style={[s.btn, active && s.btnOn]}>
        <Text style={[s.btnText, active && { color: colors.white }]} numberOfLines={1}>{active ? chosen!.label : label}</Text>
        <Icon name="chevron-down" size={16} color={active ? colors.white : colors.muted} />
      </Press>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sheet} onPress={() => undefined}>
            <Text style={[type.h2, { marginBottom: space.sm }]}>{title}</Text>
            {options.map(o => {
              const on = o.value === value;
              return (
                <Press key={String(o.value)} onPress={() => { onChange(on && clearable ? null : o.value); setOpen(false); }} style={s.row}>
                  <Text style={[type.body, on && { fontWeight: "900", color: colors.maroon }, { flex: 1 }]}>{o.label}</Text>
                  {on && <Icon name="check" size={18} color={colors.maroon} />}
                </Press>
              );
            })}
            {clearable && value !== null && (
              <Press onPress={() => { onChange(null); setOpen(false); }} style={[s.row, { justifyContent: "center" }]}><Text style={[type.body, { color: colors.red, fontWeight: "800" }]}>Clear</Text></Press>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  btnOn: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  btnText: { fontSize: 13, fontWeight: "800", color: colors.ink, maxWidth: 140 },
  backdrop: { flex: 1, backgroundColor: "rgba(35,24,21,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: space.xxl, ...shadow.lift },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
});
