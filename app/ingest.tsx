import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function IngestScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Ionicons name="close" size={24} color="#333" />
      </TouchableOpacity>

      <Text style={styles.title}>Add Words</Text>

      <View style={styles.buttonGroup}>
        <TouchableOpacity
          style={styles.sourceButton}
          onPress={() => console.log('camera pressed')}
        >
          <Ionicons name="camera-outline" size={24} color="#007AFF" style={styles.icon} />
          <Text style={styles.buttonLabel}>Camera</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sourceButton}
          onPress={() => console.log('photo library pressed')}
        >
          <Ionicons name="image-outline" size={24} color="#007AFF" style={styles.icon} />
          <Text style={styles.buttonLabel}>Photo Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sourceButton}
          onPress={() => console.log('pdf pressed')}
        >
          <Ionicons name="document-outline" size={24} color="#007AFF" style={styles.icon} />
          <Text style={styles.buttonLabel}>PDF / Document</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    padding: 24,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 32,
  },
  buttonGroup: {
    gap: 16,
  },
  sourceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
  },
  icon: {
    marginRight: 12,
  },
  buttonLabel: {
    fontSize: 16,
  },
});
