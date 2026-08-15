/**
 * Height of the on-screen keyboard in dp — Android only, always 0 on iOS.
 *
 * Under API 35+ enforced edge-to-edge the window no longer resizes for the IME
 * (`android.softwareKeyboardLayoutMode: "resize"` became advisory), and the
 * screens' iOS keyboard handling has no Android counterpart:
 * `automaticallyAdjustKeyboardInsets` is an iOS-only ScrollView prop. Without
 * this, bottom content sits *underneath* the keyboard with no way to scroll to
 * it (lesson inherited from the predecessor app's device passes).
 *
 * Apply the returned value as `paddingBottom` on a SCREEN ROOT, not on a
 * ScrollView's contentContainer: shrinking the scroll viewport is what makes
 * Android's native ScrollView scroll the focused field back into view, which
 * extra content padding alone does not do. Pair it with `tabBarHideOnKeyboard`
 * so the value isn't over-applied by the tab bar height.
 */
import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      // Pad by the actual occlusion (window bottom to keyboard top), not the
      // reported keyboard height: on 3-button navigation the keyboard floats
      // above the nav bar, so height alone under-pads by the nav-bar inset.
      const occlusion = Dimensions.get("window").height - event.endCoordinates.screenY;
      setInset(Math.max(0, Math.round(occlusion)) || event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}
