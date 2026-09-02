import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TVFocusable } from '@/src/components/TVFocusable';
import { useThemeColors } from '@/src/utils/theme';
import { getBackendUrl, getDeviceId, getToken, saveIdentity, setBackendUrl } from '@/src/config/settings';
import { api, ApiError } from '@/src/api/centralClient';
import { allOperations, getSnapshot, preparePendingRequest, completePendingRequest, failPendingRequest, readCache } from '@/src/db/operations/central';
import { readPairingAttempt, preparePairingAttempt, savePairingAttempt, clearPairingAttempt, type PairingSession } from '@/src/config/pairing';
import { allLibraryMutations } from '@/src/db/operations/libraryMutations';
import { syncFromServer } from '@/src/db/operations/sync';
type PairedDevice = { id: string; name: string; created_at: string; revoked_at: string | null };
export default function ConnectionScreen() {
  const colors = useThemeColors(); const router = useRouter();
  const [url, setUrl] = useState(getBackendUrl()); const [name, setName] = useState(Platform.isTV ? 'Android TV' : `RecallX ${Platform.OS}`);
  const [secret, setSecret] = useState(''); const [code, setCode] = useState(''); const [pairing, setPairing] = useState<PairingSession | null>(null); const [pairingPending, setPairingPending] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [paired, setPaired] = useState(!!getToken());
  const [pending, setPending] = useState(0); const [failed, setFailed] = useState(0); const [lastSync, setLastSync] = useState('');
  const [devices, setDevices] = useState<PairedDevice[]>([]); const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [libraryPending, setLibraryPending] = useState(0); const [libraryFailed, setLibraryFailed] = useState(0);
  const [pendingApproval, setPendingApproval] = useState(false);
  const actionLock = useRef(false);
  async function refreshDevices() { setDevices(await api<PairedDevice[]>('/pairing/devices')); }
  async function refreshStatus() { const [ops, snapshot, library] = await Promise.all([allOperations(), getSnapshot(), allLibraryMutations()]); setPending(ops.filter(op => op.status === 'pending').length); setFailed(ops.filter(op => op.status === 'failed').length); setLibraryPending(library.filter(op => op.status === 'pending').length); setLibraryFailed(library.filter(op => op.status === 'failed').length); setLastSync(snapshot?.server_time ?? 'Never'); }
  useEffect(() => { void refreshStatus().catch(error => setMessage(error.message)); }, []);
  useEffect(() => { void readPairingAttempt().then(attempt => {
    if (!attempt) return; setPairingPending(true); setUrl(attempt.server_url); setName(attempt.device_name);
    if (attempt.result && attempt.server_url === getBackendUrl()) setPairing(attempt.result);
    else setMessage(attempt.kind === 'bootstrap' ? 'First-device pairing is pending. Re-enter the bootstrap secret to recover it.' : 'A pairing request is pending. Show pairing code retries the same request.');
  }).catch(error => setMessage(error.message)); }, []);
  useEffect(() => { if (paired) {
    void refreshDevices().catch(error => setMessage(error.message));
    void readCache<{ body: { code: string } }>('pending_pairing_approval').then(pending => { if (pending) { setCode(pending.body.code); setPendingApproval(true); } }).catch(error => setMessage(error.message));
  } }, [paired]);
  useEffect(() => {
    if (!pairing) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let keepPolling = true;
      try {
        const result = await api<{ status: string; token?: string; device_id?: string; learner_id?: string }>(`/pairing/${pairing.id}?poll_token=${encodeURIComponent(pairing.poll_token)}`);
        if (stopped) return;
        if (result.token && result.device_id) {
          await saveIdentity({ token: result.token, device_id: result.device_id, learner_id: result.learner_id });
          await clearPairingAttempt(); setPairingPending(false);
          keepPolling = false;
          setPaired(true); setPairing(null); await syncFromServer(); await refreshStatus(); setMessage('Paired and synced.');
        } else if (result.status === 'expired') { keepPolling = false; await clearPairingAttempt(); setPairingPending(false); setPairing(null); setMessage('The code expired. Request a new code.'); }
      } catch (error) {
        if (!stopped) {
          if (error instanceof ApiError && [404, 410].includes(error.status)) { keepPolling = false; await clearPairingAttempt(); setPairingPending(false); setPairing(null); }
          setMessage(error instanceof Error ? error.message : 'Waiting for connection.');
        }
      }
      finally { if (!stopped && keepPolling) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pairing]);
  async function startPairing() {
    await setBackendUrl(url.trim());
    const attempt = await preparePairingAttempt('start', name, url.trim()); setPairingPending(true);
    const result = attempt.result ?? await api<PairingSession>('/pairing/start', { operation_id: attempt.operation_id, device_name: attempt.device_name });
    await savePairingAttempt({ ...attempt, result }); setPairing(result);
  }
  async function action(work: () => Promise<void>) { if (actionLock.current) return; actionLock.current = true; setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed.'); } finally { actionLock.current = false; setBusy(false); } }
  const button = (label: string, work: () => Promise<void>, preferred = false) => <TVFocusable disabled={busy} hasTVPreferredFocus={preferred} onPress={() => void action(work)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>{label}</Text></TVFocusable>;
  const input = (label: string, value: string, change: (value: string) => void, secure = false, readOnly = false) => <View style={{ gap: 6 }}><Text style={{ color: colors.text }}>{label}</Text><TextInput accessibilityLabel={label} secureTextEntry={secure} value={value} onChangeText={change} editable={!busy && !readOnly} autoCapitalize="none" style={[styles.input, { color: colors.text, borderColor: colors.border }]} /></View>;
  return <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]} keyboardShouldPersistTaps="handled">
    <Text style={[styles.title, { color: colors.text }]}>Connection and sync</Text>
    <Text style={{ color: colors.text }}>{paired ? 'This device is paired.' : 'Pair this device to your shared learner history.'}</Text>
    {input('Server URL', url, setUrl)}{input('Device name', name, setName)}
    {button('Save server address', async () => { await setBackendUrl(url.trim()); setMessage('Address saved.'); })}
    {pairingPending && button('Discard pending pairing request', async () => { await clearPairingAttempt(); setPairing(null); setPairingPending(false); setMessage('Pending pairing request discarded.'); })}
    {!paired && <>{button('Show pairing code', startPairing, true)}
      {pairing && <><Text style={[styles.code, { color: colors.text }]}>{pairing.code}</Text><Text style={{ color: colors.text }}>Enter this code in Connection and sync on an already paired phone or browser.</Text></>}
      {!Platform.isTV && <>{input('First device: bootstrap secret from your server terminal', secret, setSecret, true)}{button('Pair first device', async () => {
        await setBackendUrl(url.trim()); const attempt = await preparePairingAttempt('bootstrap', name, url.trim()); setPairingPending(true);
        const identity = await api<{ token: string; device_id: string; learner_id: string }>('/pairing/bootstrap', { bootstrap_secret: secret, device_name: attempt.device_name, operation_id: attempt.operation_id });
        await saveIdentity(identity); await clearPairingAttempt(); setPairingPending(false); setSecret(''); setPaired(true); await syncFromServer(); await refreshStatus(); setMessage('Paired and synced.');
      })}</>}
    </>}
    {paired && <>{button('Pair this device again', async () => { await startPairing(); setPaired(false); })}{!Platform.isTV && <>{input('Code shown on another device', code, setCode, false, pendingApproval)}{button(pendingApproval ? 'Retry saved device approval' : 'Approve device', async () => {
      const key = 'pending_pairing_approval'; const operation = await preparePendingRequest(key, { code: code.trim() });
      setPendingApproval(true);
      try { await api('/pairing/approve', { ...operation.body, operation_id: operation.id }); await completePendingRequest(key, operation.id); setPendingApproval(false); setCode(''); setMessage('Device approved.'); }
      catch (error) { if (error instanceof ApiError && [400, 403, 404, 409, 410, 422].includes(error.status)) { await failPendingRequest(key, operation.id, error.message); setPendingApproval(false); } throw error; }
    })}</>}
      {button('Sync and retry pending changes', async () => { await syncFromServer(); await refreshStatus(); await refreshDevices(); setMessage('Synced.'); }, true)}
      <Text style={{ color: colors.text }}>Pending reviews: {pending} · Failed: {failed}</Text><Text style={{ color: colors.textSecondary }}>Last confirmed snapshot: {lastSync}</Text>
      <Text style={{ color: colors.text }}>Pending library changes: {libraryPending} · Failed: {libraryFailed}</Text>
      {failed > 0 && <Text style={{ color: colors.textSecondary }}>Some saved attempts could not apply because their item or progress version changed. They remain recorded locally; refresh before a new review.</Text>}
      <Text style={[styles.title, { color: colors.text }]}>Paired devices</Text>
      {button('Refresh paired devices', refreshDevices)}
      {devices.filter(device => !device.revoked_at).map(device => <View key={device.id} style={{ gap: 10 }}>
        <Text style={{ color: colors.text }}>{device.name} · {device.id.slice(0, 8)}{device.id === getDeviceId() ? ' · This device' : ''}</Text>
        {device.id !== getDeviceId() && button(confirmRevoke === device.id ? `Confirm revoke ${device.name}` : `Revoke ${device.name}`, async () => {
          if (confirmRevoke !== device.id) { setConfirmRevoke(device.id); return; }
          const key = `pending_device_revoke:${device.id}`; const operation = await preparePendingRequest(key, { device_id: device.id });
          await api(`/pairing/devices/${encodeURIComponent(device.id)}`, undefined, 'DELETE', { 'X-Operation-ID': operation.id }); await completePendingRequest(key, operation.id); setConfirmRevoke(null); await refreshDevices(); setMessage(`${device.name} can no longer access your library.`);
        })}
      </View>)}
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text>}
    {busy && <ActivityIndicator />}
    {button('Library', async () => router.replace('/(tabs)' as any))}
  </ScrollView>;
}
const styles = StyleSheet.create({ container: { padding: Platform.isTV ? 48 : 24, gap: 18, flexGrow: 1 }, title: { fontSize: 28, fontWeight: '700' }, input: { borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 18 }, button: { padding: 16, borderRadius: 10 }, buttonText: { color: '#fff', fontSize: Platform.isTV ? 24 : 18 }, code: { fontSize: 56, fontWeight: '700', letterSpacing: 8 } });
