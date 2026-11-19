/**
 * Movement, used sparingly and only where it says something.
 *
 * ── WHY ANY OF THIS ──────────────────────────────────────────────────────────
 * Every state change in this app was instant and silent (issue E3). A button
 * that does not move when pressed does not feel pressed -- with gloves on, in
 * sun, the operator presses it again -- and a screen that swaps without moving
 * reads as unfinished software, which is not what anybody should feel about a
 * tool that certifies a machine is safe to drive.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * Decoration. Each motion here answers a question: did my press register
 * (PressableScale), where did this come from (FadeIn), did it work (PopIn).
 * All of it is skipped when the device asks for reduced motion.
 *
 * React Native's own Animated, on the native driver: no new native module in
 * the build, and nothing that can stall the JavaScript thread mid-handover.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Pressable,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';

/** True when the device has asked for less movement. Checked once. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => { if (live) setReduce(r); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return reduce;
}

type ScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far it sinks when pressed. Large buttons sink less. */
  scaleTo?: number;
  children: ReactNode;
};

/**
 * A button that visibly gives under the finger.
 *
 * Springs back rather than snapping, so a quick tap still shows. Disabled
 * buttons do not move: a control that reacts and then does nothing is worse
 * than one that plainly does not respond.
 */
export function PressableScale({ style, scaleTo = 0.97, children, disabled, ...rest }: ScaleProps) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const to = (n: number) => {
    if (reduce || disabled) return;
    Animated.spring(v, { toValue: n, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };
  // The pressable IS the animated element, so its own style -- flex, margins,
  // width -- lays it out. Wrapping an inner view instead left the outer one
  // unstyled, and a row of flex: 1 buttons collapsed to their text.
  return (
    <AnimatedPressable {...rest} disabled={disabled}
                       style={[style, { transform: [{ scale: v }] }]}
                       onPressIn={(e) => { to(scaleTo); rest.onPressIn?.(e); }}
                       onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}>
      {children}
    </AnimatedPressable>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Arrives from slightly below (or the side) and fades in.
 *
 * Starts VISIBLE when motion is reduced, and the distance is small: this says
 * "new", it does not perform. `delay` staggers a list so the eye reads it
 * top to bottom.
 */
export function FadeIn({ children, delay = 0, from = 'below', style }: {
  children: ReactNode; delay?: number; from?: 'below' | 'right';
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.cubic),
                         useNativeDriver: true }).start();
  }, [reduce, delay, v]);
  const shift = v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return (
    <Animated.View style={[style, {
      opacity: v,
      transform: [from === 'below' ? { translateY: shift } : { translateX: shift }],
    }]}>
      {children}
    </Animated.View>
  );
}

/** A mark that lands: the tick on a saved handover, the "!" on a held one. */
export function PopIn({ children, delay = 80, style }: {
  children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.spring(v, { toValue: 1, delay, useNativeDriver: true, speed: 12, bounciness: 12 })
      .start();
  }, [reduce, delay, v]);
  return (
    <Animated.View style={[style, {
      opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}
