import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  Text,
  View,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import { takePendingCropUri } from '@/src/store/pendingCropUri';
import { setPendingCropResult } from '@/src/store/pendingCropResult';
import { computeDisplayMetrics, screenToCropRect } from '@/src/utils/cropCoordinates';
import type { DisplayMetrics } from '@/src/utils/cropCoordinates';

const MIN_CROP_PX = 50;

export default function CropScreen() {
  const uri = useRef(takePendingCropUri()).current;

  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const metricsRef = useRef<DisplayMetrics | null>(null);

  // Crop rect corners in screen space (Animated.Value for smooth rendering)
  const x1 = useRef(new Animated.Value(0)).current;
  const y1 = useRef(new Animated.Value(0)).current;
  const x2 = useRef(new Animated.Value(0)).current;
  const y2 = useRef(new Animated.Value(0)).current;

  // Ref copies of animated values for reading in PanResponder callbacks
  const x1Ref = useRef(0);
  const y1Ref = useRef(0);
  const x2Ref = useRef(0);
  const y2Ref = useRef(0);

  // Keep refs in sync with Animated values
  useEffect(() => {
    const sub1 = x1.addListener(({ value }) => { x1Ref.current = value; });
    const sub2 = y1.addListener(({ value }) => { y1Ref.current = value; });
    const sub3 = x2.addListener(({ value }) => { x2Ref.current = value; });
    const sub4 = y2.addListener(({ value }) => { y2Ref.current = value; });
    return () => {
      x1.removeListener(sub1);
      y1.removeListener(sub2);
      x2.removeListener(sub3);
      y2.removeListener(sub4);
    };
  }, [x1, y1, x2, y2]);

  // Guard against missing URI (should not happen in normal flow)
  useEffect(() => {
    if (!uri) router.back();
  }, []);

  // Load image natural dimensions
  useEffect(() => {
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => setImageSize({ w, h }),
      () => {
        Alert.alert('Error', 'Could not load image.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    );
  }, [uri]);

  // Once both container and image sizes are known, initialize crop rect to 80% centered
  useEffect(() => {
    if (!containerSize || !imageSize) return;
    const metrics = computeDisplayMetrics(containerSize.w, containerSize.h, imageSize.w, imageSize.h);
    metricsRef.current = metrics;

    const displayedW = imageSize.w * metrics.scale;
    const displayedH = imageSize.h * metrics.scale;
    const inset = 0.1;

    const initX1 = metrics.offsetX + displayedW * inset;
    const initY1 = metrics.offsetY + displayedH * inset;
    const initX2 = metrics.offsetX + displayedW * (1 - inset);
    const initY2 = metrics.offsetY + displayedH * (1 - inset);

    x1.setValue(initX1); x1Ref.current = initX1;
    y1.setValue(initY1); y1Ref.current = initY1;
    x2.setValue(initX2); x2Ref.current = initX2;
    y2.setValue(initY2); y2Ref.current = initY2;
  }, [containerSize, imageSize]);

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setContainerSize({ w: width, h: height });
      }}
    >
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
      />

      {/* Overlay — 4 pieces framing the crop rect */}
      <Animated.View style={[styles.overlay, { top: 0, left: 0, right: 0, height: y1 }]} />
      <Animated.View style={[styles.overlay, { top: y2, left: 0, right: 0, bottom: 0 }]} />
      <Animated.View
        style={[styles.overlay, { top: y1, height: Animated.subtract(y2, y1), left: 0, width: x1 }]}
      />
      <Animated.View
        style={[styles.overlay, { top: y1, height: Animated.subtract(y2, y1), left: x2, right: 0 }]}
      />

      <View style={styles.buttonBar}>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={() => {}}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  buttonBar: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  cancelText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  doneButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#007AFF',
  },
  doneText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
