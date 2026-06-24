import * as Speech from 'expo-speech';

// List of known high-quality English female voice name parts
const FEMALE_NAMES = [
  'samantha',
  'karen',
  'moira',
  'fiona',
  'tessa',
  'veena',
  'susan',
  'nicki',
  'catherine',
  'allison',
  'ava',
  'zoe',
  'zira',
  'hazel',
  'melina',
  'serena',
  'female',
  'siri female',
];

/**
 * Checks if a voice name is likely female based on common TTS voice names.
 */
export function isFemaleVoice(name: string): boolean {
  const lowerName = name.toLowerCase();
  return FEMALE_NAMES.some((femaleName) => lowerName.includes(femaleName));
}

/**
 * Filter and sort available English voices to find the highest-quality female voice.
 */
export function getBestFemaleVoice(voices: Speech.Voice[]): Speech.Voice | undefined {
  // 1. Filter English voices
  const englishVoices = voices.filter((v) =>
    v.language && v.language.toLowerCase().startsWith('en')
  );

  if (englishVoices.length === 0) return undefined;

  // 2. Separate into quality/gender tiers
  // Tier 1: Enhanced/Premium Female
  const enhancedFemale = englishVoices.filter(
    (v) => v.quality === Speech.VoiceQuality.Enhanced && isFemaleVoice(v.name)
  );
  if (enhancedFemale.length > 0) return enhancedFemale[0];

  // Tier 2: Default quality Female
  const defaultFemale = englishVoices.filter((v) => isFemaleVoice(v.name));
  if (defaultFemale.length > 0) return defaultFemale[0];

  // Tier 3: Enhanced Quality English (any gender/default)
  const enhancedEnglish = englishVoices.filter((v) => v.quality === Speech.VoiceQuality.Enhanced);
  if (enhancedEnglish.length > 0) return enhancedEnglish[0];

  // Tier 4: First English voice
  return englishVoices[0];
}

/**
 * Asynchronously checks all available voices on the device and returns the
 * identifier of the best high-quality English female voice, if found.
 */
export async function getSmartDefaultVoice(): Promise<string | undefined> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const bestVoice = getBestFemaleVoice(voices);
    return bestVoice?.identifier;
  } catch (err) {
    if (__DEV__) console.warn('[SpeechUtils] Failed to get available voices', err);
    return undefined;
  }
}
