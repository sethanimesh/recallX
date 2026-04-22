import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { getBackendUrl } from '@/src/config/settings';

import { fetchAllWords, fetchWordsByTag, type WordRow } from '@/src/db/operations/tags';
import { fetchDueWords, updateWordSRS, type WordSRSRow } from '@/src/db/operations/srs';
import {
  insertSession,
  closeSession,
  insertSessionResult,
  fetchRecentlyWrongIds,
  fetchTodayWordIds,
  fetchWordsCreatedTodayForRecall,
} from '@/src/db/operations/sessionHistory';
import { tutorChat, type ChatMessage } from '@/src/api/tutorClient';
import {
  createSession,
  getNextCard,
  handleResponse,
  type Session,
  type CardState,
  type SRSUpdate,
} from '@/src/screens/srsAlgorithm';

interface UIChatMessage {
  id: string;
  sender: 'tutor' | 'user';
  text: string;
  timestamp: Date;
  wordId?: string;
  isHint?: boolean;
}

export default function TutorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tagId, todayOnly, sortOrder } = useLocalSearchParams<{ tagId: string; todayOnly: string; sortOrder?: string }>();

  // SRS state
  const [session, setSession] = useState<Session | null>(null);
  const [currentCard, setCurrentCard] = useState<CardState | null>(null);
  const [deckLoaded, setDeckLoaded] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // Tracking
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const missedIdsRef = useRef<string[]>([]);
  const sessionIdRef = useRef<string>(Date.now().toString(36) + Math.random().toString(36).slice(2));
  const attemptCountRef = useRef<Map<string, number>>(new Map());
  const preSeededIdsRef = useRef<Set<string>>(new Set());
  const clearedFromBufferRef = useRef<string[]>([]);
  const recentlyWrongIdsRef = useRef<string[]>([]);

  // UI state
  const [chatMessages, setChatMessages] = useState<UIChatMessage[]>([]);
  const [userText, setUserText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [wordHistory, setWordHistory] = useState<ChatMessage[]>([]);
  const flatListRef = useRef<FlatList>(null);



  // Load words pool and initialize session
  useEffect(() => {
    async function loadDeck() {
      const wordsPool = todayOnly === 'true'
        ? await fetchWordsCreatedTodayForRecall(tagId && tagId.length > 0 ? tagId : undefined)
        : tagId && tagId.length > 0
          ? await fetchDueWords(tagId)
          : await fetchDueWords();
      const dueIds = wordsPool.map(w => w.id);
      const wrongIds = await fetchRecentlyWrongIds('recall', dueIds);
      const todayIds = todayOnly === 'true' ? [] : await fetchTodayWordIds(dueIds);
      
      recentlyWrongIdsRef.current = wrongIds;
      preSeededIdsRef.current = new Set(wrongIds);

      const newSession = createSession(wordsPool, wrongIds, todayIds);
      if (sortOrder === 'alphabetical') {
        newSession.mainDeck.sort((a, b) => a.word.word.localeCompare(b.word.word));
      }

      await insertSession(sessionIdRef.current, 'recall', tagId && tagId.length > 0 ? tagId : undefined);
      setSession(newSession);

      const firstCard = getNextCard(newSession);
      if (firstCard) {
        setCurrentCard(firstCard);
        // Start the chat history with greetings
        const greetingText = `Hello! I'm your AI vocabulary tutor. Let's practice your words. Here is the first word: "${firstCard.word.word}". Do you know what this means?`;
        appendTutorMessage(greetingText, firstCard.word.id);
        setWordHistory([]);
      } else {
        setIsDone(true);
      }
      setDeckLoaded(true);
    }
    loadDeck().catch(() => setDeckLoaded(true));
  }, []);



  const soundRef = useRef<Audio.Sound | null>(null);

  const stopAndUnloadSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch {}
      soundRef.current = null;
    }
  };

  const playTutorSpeech = async (text: string) => {
    if (!isSoundEnabled) return;
    
    try {

      await stopAndUnloadSound();
      
      const backendUrl = getBackendUrl();
      const speakUrl = `${backendUrl.replace(/\/$/, '')}/tutor/speak?text=${encodeURIComponent(text)}`;
      
      const { sound } = await Audio.Sound.createAsync(
        { uri: speakUrl },
        { shouldPlay: true }
      );
      
      soundRef.current = sound;
      
      sound.setOnPlaybackStatusUpdate(async (status) => {
        if (status.isLoaded && status.didJustFinish) {
          await stopAndUnloadSound();
        }
      });
      
    } catch (err) {
      console.warn('[Tutor] Play tutor speech failed:', err);
    }
  };

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      Speech.stop().catch(() => {});
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const appendTutorMessage = (text: string, wordId?: string, isHint = false) => {
    setChatMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: 'tutor',
        text,
        timestamp: new Date(),
        wordId,
        isHint,
      },
    ]);
    playTutorSpeech(text);
  };

  const appendUserMessage = (text: string) => {
    setChatMessages(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        sender: 'user',
        text,
        timestamp: new Date(),
      },
    ]);
  };

  const recordAttempt = (wordId: string, correct: boolean) => {
    const prev = attemptCountRef.current.get(wordId) ?? 0;
    const attempt = prev + 1;
    attemptCountRef.current.set(wordId, attempt);
    insertSessionResult(sessionIdRef.current, wordId, correct, attempt).catch(() => {});
  };

  const handleNextWord = (currentSess: Session) => {
    const nextCard = getNextCard(currentSess);
    if (!nextCard) {
      // Completed session
      appendTutorMessage("Excellent work! We have finished reviewing all the words in this session. Let's see your results!");
      setTimeout(() => {
        navigateToSummary();
      }, 3000);
      return;
    }

    setCurrentCard(nextCard);
    setWordHistory([]);

    const isRetry = nextCard.inBuffer;
    const wordPrompt = isRetry
      ? `Let's try this word again: "${nextCard.word.word}". Do you remember its meaning now?`
      : `Next word: "${nextCard.word.word}". What does this mean?`;
    
    appendTutorMessage(wordPrompt, nextCard.word.id);
  };

  const navigateToSummary = () => {
    closeSession(sessionIdRef.current).catch(() => {});
    router.replace({
      pathname: '/recall-summary' as any,
      params: {
        score: String(score),
        total: String(total),
        tagId: tagId ?? '',
        mode: 'tutor',
        recentlyWrongIds: recentlyWrongIdsRef.current.join(','),
        clearedFromBuffer: clearedFromBufferRef.current.join(','),
        missedIds: missedIdsRef.current.join(','),
      },
    });
  };

  const handleSubmit = async (textOverride?: string) => {
    const answer = (textOverride ?? userText).trim();
    if (!answer || !currentCard || loading) return;

    appendUserMessage(answer);
    setUserText('');
    setLoading(true);


    const isRetry = currentCard.inBuffer;

    try {
      const response = await tutorChat({
        word: currentCard.word.word,
        stored_definition: currentCard.word.definition,
        stored_example: currentCard.word.example_sentence,
        user_answer: answer,
        history: wordHistory,
        is_retry: isRetry,
      });

      // Show tutor response
      appendTutorMessage(response.response, currentCard.word.id, response.hint_provided);

      // Track conversational history for current word
      const updatedHistory: ChatMessage[] = [
        ...wordHistory,
        { role: 'user', content: answer },
        { role: 'assistant', content: response.response },
      ];
      setWordHistory(updatedHistory);

      // Analyze evaluation outcome
      const isCorrectOrClose = response.evaluation === 'correct' || response.evaluation === 'close';
      
      // If a hint was provided because they couldn't remember, we don't advance the card yet.
      // We allow them to try again on the same word, but we log the attempt as wrong.
      if (response.hint_provided) {
        setTotal(t => t + 1);
        recordAttempt(currentCard.word.id, false);

        // Put card in SRS buffer state immediately
        const { session: newSess, srsUpdate } = handleResponse(session!, currentCard, false);
        setSession(newSess);
        updateWordSRS(
          currentCard.word.id,
          srsUpdate.interval,
          srsUpdate.easeFactor,
          srsUpdate.nextReviewAt,
          srsUpdate.wrongCount,
          srsUpdate.consecutiveCorrect
        ).catch(() => {});
        
        // Update the currentCard so that its inBuffer is true and statistics are maintained
        const activeCard = newSess.buffer.find(c => c.word.id === currentCard.word.id) || currentCard;
        setCurrentCard({ ...activeCard, inBuffer: true });

        if (!missedIdsRef.current.includes(currentCard.word.id)) {
          missedIdsRef.current.push(currentCard.word.id);
        }
      } else {
        // If no hint was provided, the attempt finishes the current turn for this word
        setTotal(t => t + 1);
        if (isCorrectOrClose) setScore(s => s + 1);

        recordAttempt(currentCard.word.id, isCorrectOrClose);

        if (!isCorrectOrClose && !missedIdsRef.current.includes(currentCard.word.id)) {
          missedIdsRef.current.push(currentCard.word.id);
        }

        // Apply SRS algorithm
        const { session: newSess, srsUpdate } = handleResponse(session!, currentCard, isCorrectOrClose);
        setSession(newSess);
        
        // Update database SRS details
        updateWordSRS(
          currentCard.word.id,
          srsUpdate.interval,
          srsUpdate.easeFactor,
          srsUpdate.nextReviewAt,
          srsUpdate.wrongCount,
          srsUpdate.consecutiveCorrect
        ).catch(() => {});

        // Check if pre-seeded recentlyWrong was cleared
        if (
          isCorrectOrClose &&
          currentCard.inBuffer &&
          preSeededIdsRef.current.has(currentCard.word.id) &&
          !newSess.buffer.some(c => c.word.id === currentCard.word.id)
        ) {
          if (!clearedFromBufferRef.current.includes(currentCard.word.id)) {
            clearedFromBufferRef.current.push(currentCard.word.id);
          }
        }

        // Advance to next word after a short reading break (2.5 seconds)
        setTimeout(() => {
          handleNextWord(newSess);
        }, 2500);
      }

    } catch (err) {
      appendTutorMessage("Oops! I couldn't reach the server. Let's try again.");
    } finally {
      setLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: UIChatMessage }) => {
    const isUser = item.sender === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.tutorRow]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Ionicons name="school-outline" size={16} color="#fff" />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.tutorBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.tutorMessageText]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  if (!deckLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (isDone) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No words to review</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeBufferCount = session?.buffer.length ?? 0;
  const mainDeckCount = session?.mainDeck.length ?? 0;
  const progressPercent = total > 0 ? Math.min(100, Math.round((score / total) * 100)) : 0;

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backChevron}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>AI Vocabulary Tutor</Text>
          <Text style={styles.headerSubtitle}>
            {mainDeckCount} pending · {activeBufferCount} active retries
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setIsSoundEnabled(!isSoundEnabled)}
          style={[styles.soundButton, !isSoundEnabled && styles.soundButtonMuted]}
        >
          <Ionicons
            name={isSoundEnabled ? 'volume-high' : 'volume-mute'}
            size={20}
            color={isSoundEnabled ? '#3B82F6' : '#9CA3AF'}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
      </View>

      <View style={styles.scoreHeader}>
        <Text style={styles.scoreText}>Score: {score} / {total}</Text>
        {currentCard && (
          <View style={styles.currentWordBadge}>
            <Text style={styles.currentWordText}>{currentCard.word.word}</Text>
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={chatMessages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={[styles.inputSection, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            placeholder="Define the word or ask for a hint..."
            value={userText}
            onChangeText={setUserText}
            editable={!loading}
            onSubmitEditing={() => handleSubmit()}
            returnKeyType="send"
          />
          {loading ? (
            <ActivityIndicator style={styles.sendIcon} size="small" color="#3B82F6" />
          ) : (
            <TouchableOpacity
              onPress={() => handleSubmit()}
              style={[styles.sendButton, !userText.trim() && styles.sendButtonDisabled]}
              disabled={!userText.trim()}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </View>


      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24 },
  emptyText: { fontSize: 18, color: '#6B7280', marginBottom: 24, textAlign: 'center' },
  backButton: { backgroundColor: '#3B82F6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 32 },
  backButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backChevron: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitleContainer: { flex: 1, paddingHorizontal: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 12, color: '#6B7280' },
  soundButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  soundButtonMuted: { backgroundColor: '#F3F4F6' },
  progressBarContainer: { height: 3, backgroundColor: '#E5E7EB', width: '100%' },
  progressBarFill: { height: '100%', backgroundColor: '#3B82F6' },
  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F3F4F6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  scoreText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  currentWordBadge: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentWordText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  chatList: { padding: 16, gap: 12, paddingBottom: 32 },
  messageRow: { flexDirection: 'row', width: '100%', marginBottom: 4 },
  userRow: { justifyContent: 'end', alignSelf: 'flex-end' },
  tutorRow: { justifyContent: 'start', alignSelf: 'flex-start', gap: 8 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12 },
  userBubble: {
    backgroundColor: '#3B82F6',
    borderBottomRightRadius: 2,
    alignSelf: 'flex-end',
  },
  tutorBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  userMessageText: { color: '#fff' },
  tutorMessageText: { color: '#1F2937' },
  inputSection: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
    maxHeight: 100,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#9CA3AF' },
  sendIcon: { width: 38, height: 38, justifyContent: 'center', alignItems: 'center' },

});
