import { TrackerClient } from '@/components/TrackerClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lady Macbeth / Macbeth — Speech-Score Engine',
  description:
    'A contemporary character poem by @two.be, performed as a synchronized two-voice score with artwork by @amaanjahangir.',
};

export default function LadyMacbethMacbethPage() {
  return (
    <>
      <link rel="stylesheet" href="/prototypes/tracker.css" />
      <main style={{ position: 'fixed', inset: 0, background: '#fff', color: '#1d1d1b' }}>
        <TrackerClient defaultScoreId="lady-macbeth-macbeth" defaultVoiceConfig="separated" />
      </main>
    </>
  );
}
