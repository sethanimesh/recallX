import { Text, Linking, StyleProp, TextStyle, View, StyleSheet } from 'react-native';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';

export default function TextWithLinks({ text, style, italic }: { text: string; style?: StyleProp<TextStyle>; italic?: boolean }) {
  if (!text) return null;

  // Split out the Etymology or Root part if it exists
  const etymologyRegex = /\n\n(?:Etymology|Root):\s*(.*)/is;
  const match = text.match(etymologyRegex);
  
  let mainText = text;
  let etymologyText: string | null = null;
  
  if (match) {
    mainText = text.replace(etymologyRegex, '');
    etymologyText = match[1].trim();
  }

  const renderLinks = (content: string, isEtymology = false) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (!content.match(urlRegex)) {
      return <Text style={[style, italic && { fontStyle: 'italic' }, isEtymology && styles.etymologyText]}>{content}</Text>;
    }
    const parts = content.split(urlRegex);
    return (
      <Text style={[style, italic && { fontStyle: 'italic' }, isEtymology && styles.etymologyText]}>
        {parts.map((part, i) => {
          if (part.match(urlRegex)) {
            return (
              <Text
                key={i}
                style={[styles.link, isEtymology && styles.etymologyLink]}
                onPress={(e) => {
                  e.stopPropagation();
                  Linking.openURL(part).catch(() => {});
                }}
              >
                {isEtymology ? 'Open in Etymonline' : part}
              </Text>
            );
          }
          // Remove the trailing hyphen before the URL if we format it as a clean button
          const cleanPart = isEtymology && i > 0 && parts[i-1].match(urlRegex) === null ? part.replace(/\s*-\s*$/, ' ') : part;
          return <Text key={i}>{cleanPart}</Text>;
        })}
      </Text>
    );
  };

  return (
    <View style={styles.container}>
      {renderLinks(mainText)}
      {etymologyText && (
        <View style={styles.etymologyContainer}>
          <View style={styles.etymologyHeader}>
            <Ionicons name="git-network-outline" size={14} color="#6B7280" />
            <Text style={styles.etymologyLabel}>Roots</Text>
          </View>
          {renderLinks(etymologyText, true)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
  },
  link: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  etymologyContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#9CA3AF',
    width: '100%',
  },
  etymologyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  etymologyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  etymologyText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  etymologyLink: {
    fontWeight: '600',
    color: '#2563EB',
    textDecorationLine: 'none',
  }
});
