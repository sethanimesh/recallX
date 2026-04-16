import { isFemaleVoice, getBestFemaleVoice } from '../speech';
import * as Speech from 'expo-speech';

jest.mock('expo-speech', () => ({
  getAvailableVoicesAsync: jest.fn(),
  speak: jest.fn(),
  stop: jest.fn(),
}));

describe('speech utilities', () => {
  describe('isFemaleVoice', () => {
    it('returns true for common female voice names', () => {
      expect(isFemaleVoice('Samantha')).toBe(true);
      expect(isFemaleVoice('com.apple.ttsbundle.Samantha-compact')).toBe(true);
      expect(isFemaleVoice('Karen (Enhanced)')).toBe(true);
      expect(isFemaleVoice('Moira')).toBe(true);
      expect(isFemaleVoice('Google en-US-female')).toBe(true);
    });

    it('returns false for male or generic names', () => {
      expect(isFemaleVoice('Daniel')).toBe(false);
      expect(isFemaleVoice('com.apple.ttsbundle.Daniel-premium')).toBe(false);
      expect(isFemaleVoice('Tom')).toBe(false);
    });
  });

  describe('getBestFemaleVoice', () => {
    it('returns undefined when no voices are provided', () => {
      expect(getBestFemaleVoice([])).toBeUndefined();
    });

    it('returns undefined when no English voices are provided', () => {
      const voices: Speech.Voice[] = [
        { identifier: 'fr-1', name: 'Thomas', language: 'fr-FR', quality: 'enhanced' },
        { identifier: 'es-1', name: 'Monica', language: 'es-ES', quality: 'default' },
      ];
      expect(getBestFemaleVoice(voices)).toBeUndefined();
    });

    it('prioritizes Enhanced English Female voices (Tier 1)', () => {
      const voices: Speech.Voice[] = [
        { identifier: 'en-1', name: 'Daniel', language: 'en-US', quality: 'enhanced' },
        { identifier: 'en-2', name: 'Samantha', language: 'en-US', quality: 'default' },
        { identifier: 'en-3', name: 'Karen', language: 'en-AU', quality: 'enhanced' },
      ];
      // Karen is English, Enhanced and Female.
      expect(getBestFemaleVoice(voices)).toEqual(voices[2]);
    });

    it('falls back to Default English Female voices (Tier 2)', () => {
      const voices: Speech.Voice[] = [
        { identifier: 'en-1', name: 'Daniel', language: 'en-US', quality: 'enhanced' },
        { identifier: 'en-2', name: 'Samantha', language: 'en-US', quality: 'default' },
        { identifier: 'en-3', name: 'Tom', language: 'en-GB', quality: 'default' },
      ];
      // Samantha is English, Default, and Female.
      expect(getBestFemaleVoice(voices)).toEqual(voices[1]);
    });

    it('falls back to Enhanced English Male/Generic voices (Tier 3)', () => {
      const voices: Speech.Voice[] = [
        { identifier: 'en-1', name: 'Daniel', language: 'en-US', quality: 'enhanced' },
        { identifier: 'en-2', name: 'Tom', language: 'en-GB', quality: 'default' },
      ];
      // Daniel is English, Enhanced, but Male.
      expect(getBestFemaleVoice(voices)).toEqual(voices[0]);
    });

    it('falls back to any English voice (Tier 4)', () => {
      const voices: Speech.Voice[] = [
        { identifier: 'en-1', name: 'Tom', language: 'en-GB', quality: 'default' },
      ];
      expect(getBestFemaleVoice(voices)).toEqual(voices[0]);
    });
  });
});
