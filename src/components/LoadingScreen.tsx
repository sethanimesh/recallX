import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View, useColorScheme } from 'react-native';

const RING_DURATION = 2400;
const RING_STAGGER = 600;

export function LoadingScreen() {
  const containerOpacity = useRef(new Animated.Value(0)).current;

  // Three ripple rings — each: scale 1→3.2, opacity 0.7→0
  const ring0Scale = useRef(new Animated.Value(1)).current;
  const ring0Opacity = useRef(new Animated.Value(0.7)).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0.7)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0.7)).current;

  // Core pulse
  const coreScale = useRef(new Animated.Value(1)).current;

  // Progress bar sweep (0→1→0)
  const barProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(containerOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  // Ripple animation for one ring
  const startRipple = (scale: Animated.Value, opacity: Animated.Value, delay: number) => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 3.2, duration: RING_DURATION, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: RING_DURATION, useNativeDriver: true }),
        ]),
        // reset instantly before next loop
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.7, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(RING_STAGGER * (3 - Math.round(delay / RING_STAGGER)) - 0),
      ])
    );
    loop.start();
    return loop;
  };

  useEffect(() => {
    const a0 = startRipple(ring0Scale, ring0Opacity, 0);
    const a1 = startRipple(ring1Scale, ring1Opacity, RING_STAGGER);
    const a2 = startRipple(ring2Scale, ring2Opacity, RING_STAGGER * 2);
    return () => { a0.stop(); a1.stop(); a2.stop(); };
  }, []);

  // Core pulse
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(coreScale, { toValue: 1.2, duration: 1200, useNativeDriver: true }),
        Animated.timing(coreScale, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Bar sweep
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(barProgress, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(barProgress, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const barWidth = barProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '80%'],
  });

  const RING_SIZE = 24;

  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const colors = {
    rootBg: isDark ? '#12100e' : '#fdfbf8',
    ringBorder: isDark ? '#dca87a' : '#c4956a',
    coreBg: isDark ? '#dca87a' : '#c4956a',
    titleText: isDark ? '#f5e6d3' : '#2d2a24',
    subText: isDark ? '#9a8b75' : '#a89880',
    barTrackBg: isDark ? '#2e2924' : '#ede8e0',
    barFillBg: isDark ? '#dca87a' : '#c4956a',
  };

  return (
    <Animated.View style={[styles.root, { opacity: containerOpacity, backgroundColor: colors.rootBg }]}>
      {/* Ripple */}
      <View style={styles.rippleWrap}>
        {[
          [ring0Scale, ring0Opacity],
          [ring1Scale, ring1Opacity],
          [ring2Scale, ring2Opacity],
        ].map(([scale, opacity], i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              { width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2, borderColor: colors.ringBorder },
              { opacity: opacity as Animated.Value, transform: [{ scale: scale as Animated.Value }] },
            ]}
          />
        ))}
        <Animated.View style={[styles.core, { transform: [{ scale: coreScale }], backgroundColor: colors.coreBg }]} />
      </View>

      {/* Text */}
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.titleText }]}>Just a moment</Text>
        <Text style={[styles.sub, { color: colors.subText }]}>Fetching your memories…</Text>
        <View style={[styles.barTrack, { backgroundColor: colors.barTrackBg }]}>
          <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: colors.barFillBg }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fdfbf8',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  rippleWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#c4956a',
  },
  core: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#c4956a',
  },
  textBlock: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontSize: 22,
    color: '#2d2a24',
  },
  sub: {
    fontSize: 12,
    color: '#a89880',
    letterSpacing: 0.3,
  },
  barTrack: {
    width: 120,
    height: 2,
    backgroundColor: '#ede8e0',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 20,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#c4956a',
    borderRadius: 2,
  },
});
