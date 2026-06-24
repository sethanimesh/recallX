import { Platform, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// A simple way to detect if we are running on a TV device
export const isTV = Platform.isTV;

// For TV, screens are usually 1080p or 4K. 
// A factor of 1.5x - 2.0x usually works well to make mobile layouts readable from 10 feet away.
const TV_SCALE_FACTOR = 1.5;

/**
 * Scales size values (padding, margin, width, height) appropriately for TV.
 */
export function scaleSize(size: number): number {
  if (isTV) {
    return size * TV_SCALE_FACTOR;
  }
  return size;
}

/**
 * Scales font sizes appropriately for TV.
 */
export function scaleFont(size: number): number {
  if (isTV) {
    return size * TV_SCALE_FACTOR;
  }
  return size;
}
