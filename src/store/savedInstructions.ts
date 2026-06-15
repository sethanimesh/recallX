import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@recallx_saved_instructions';

export async function getSavedInstructions(): Promise<string[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json) {
      return JSON.parse(json) as string[];
    }
  } catch (err) {
    console.error('Failed to load saved instructions', err);
  }
  return [];
}

export async function addSavedInstruction(instruction: string): Promise<string[]> {
  const current = await getSavedInstructions();
  const trimmed = instruction.trim();
  if (!trimmed || current.includes(trimmed)) return current;
  
  const updated = [trimmed, ...current].slice(0, 20); // Keep max 20
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save instruction', err);
  }
  return updated;
}

export async function removeSavedInstruction(instruction: string): Promise<string[]> {
  const current = await getSavedInstructions();
  const updated = current.filter(i => i !== instruction);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to remove instruction', err);
  }
  return updated;
}
