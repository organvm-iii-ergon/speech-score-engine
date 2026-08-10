import { TrackerClient } from '@/components/TrackerClient';
import type { Metadata } from 'next';

const SCORE_IDS = [
  'philip-glass',
  'richard-and-anne',
  'earnest-duet',
  'macbeth-witches',
  'lady-macbeth-macbeth',
] as const;

export const metadata: Metadata = {
  title: 'Score — Speech-Score Engine',
  description:
    'Perform a score as a temporal speech-score with artwork, voice treatment, and live cue.',
};

export function generateStaticParams() {
  return SCORE_IDS.map((scoreId) => ({ scoreId }));
}

export default async function ScorePage({
  params,
}: {
  params: Promise<{ scoreId: string }>;
}) {
  const { scoreId } = await params;
  return (
    <>
      <link rel="stylesheet" href="/prototypes/tracker.css" />
      <main style={{ position: 'fixed', inset: 0, background: '#fff', color: '#1d1d1b' }}>
        <TrackerClient defaultScoreId={scoreId} defaultVoiceConfig="separated" />
      </main>
    </>
  );
}
