/**
 * The small print App Review reads: what stays free, the auto-renewal terms,
 * and the two legal links.
 *
 * The links come from lib/legalLinks.ts, which is the single place the URLs are
 * filled in. While a page is unpublished its row renders struck through and
 * inert with a note saying why — a reviewer taps both of these, and a link that
 * silently goes nowhere is worse than one that admits it isn't live yet.
 */
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import {
  hasUnpublishedLegalLink,
  isPublished,
  LEGAL_LINKS,
  type LegalLink,
} from "@/lib/legalLinks";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

import { FREE_TIER_NOTE, LEGAL_PENDING_NOTE, RENEWAL_DISCLOSURE } from "./paywallCopy";

interface LegalFooterProps {
  /** Hidden for subscribers — the free tier is no longer their situation. */
  showFreeTierNote: boolean;
}

export function LegalFooter({ showFreeTierNote }: LegalFooterProps) {
  return (
    <>
      {showFreeTierNote ? <Text style={styles.freeNote}>{FREE_TIER_NOTE}</Text> : null}
      {/* Shown to subscribers too: it is where the renewal terms and the
          cancellation route live. */}
      <Text style={styles.disclosure}>{RENEWAL_DISCLOSURE}</Text>
      <View style={styles.legalRow}>
        {LEGAL_LINKS.map((link) => (
          <LegalLinkItem key={link.label} link={link} />
        ))}
      </View>
      {hasUnpublishedLegalLink() ? (
        <Text style={styles.legalNote}>{LEGAL_PENDING_NOTE}</Text>
      ) : null}
    </>
  );
}

function LegalLinkItem({ link }: { link: LegalLink }) {
  const live = isPublished(link);
  const open = () => {
    const url = link.url;
    if (url === null) return;
    selectionHaptic();
    // openURL rejects when nothing can handle the URL; that must become an
    // alert, never an unhandled rejection.
    void Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open the page", `Visit ${url} in your browser.`);
    });
  };
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={live ? link.label : `${link.label} — not published yet`}
      accessibilityState={{ disabled: !live }}
      disabled={!live}
      onPress={open}
      style={({ pressed }) => [styles.legalLink, pressed && styles.pressed]}
    >
      <Text style={live ? styles.legalLabel : styles.legalLabelOff}>{link.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  freeNote: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  disclosure: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  legalRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  legalLink: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
  legalLabel: { ...type.label, color: colors.accentText, textDecorationLine: "underline" },
  legalLabelOff: { ...type.label, color: colors.textFaint, textDecorationLine: "line-through" },
  legalNote: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  pressed: { opacity: 0.7 },
});
