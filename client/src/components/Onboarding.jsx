import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Card, CardBody } from '@heroui/react';
import { Film, Camera, Layers } from 'lucide-react';
import { getAppConfig, updateAppConfig, setOnboardingChoice, getRolls } from '../api';

const MODE_KEY = 'fg-workspace-mode';
export const WORKSPACE_EVENT = 'fg-set-workspace-mode';

const CARDS = [
  { choice: 'film', icon: Film, title: 'Film', desc: 'Manage rolls, developing and scanned photos' },
  { choice: 'digital', icon: Camera, title: 'Digital', desc: 'Import and manage digital camera photos' },
  { choice: 'both', icon: Layers, title: 'Both', desc: 'Use film and digital workspaces together' },
];

export default function Onboarding() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState('gate');
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: config, isError } = useQuery({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const needsOnboarding = !!config && Number(config.onboarding_completed) !== 1;

  const { data: rolls, isLoading: rollsLoading } = useQuery({
    queryKey: ['onboarding-rolls-probe'],
    queryFn: () => getRolls(),
    enabled: needsOnboarding,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (isError || !needsOnboarding || dismissed) return null;
  if (rollsLoading) return null;

  const hasExistingData = Array.isArray(rolls) && rolls.length > 0;
  const showGate = hasExistingData && step === 'gate';

  const applyWorkspace = (m) => {
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: m }));
  };

  const markCompleted = async () => {
    try {
      await updateAppConfig({ onboarding_completed: 1 });
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
    } catch { /* ignore */ }
  };

  const handleChoice = async (choice) => {
    setBusy(true);
    try {
      await setOnboardingChoice({ choice });
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
      if (choice === 'film' || choice === 'digital') applyWorkspace(choice);
    } catch { /* ignore */ }
    setBusy(false);
    setDismissed(true);
  };

  const handleSkip = async () => {
    setBusy(true);
    await markCompleted();
    setBusy(false);
    setDismissed(true);
  };

  return (
    <Modal isOpen backdrop="blur" isDismissable={false} hideCloseButton size={showGate ? 'md' : '2xl'}>
      <ModalContent>
        {showGate ? (
          <>
            <ModalHeader className="text-xl font-bold">FilmGallery now supports digital photos</ModalHeader>
            <ModalBody>
              <p className="text-default-500 text-sm">
                Alongside the film workspace, you can now import, organize, and manage digital camera photos. Pick your default workspace now, or adjust it later in Settings.
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={handleSkip} isDisabled={busy}>Maybe later</Button>
              <Button color="primary" onPress={() => setStep('cards')} isDisabled={busy}>Set up my workspace</Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span className="text-xl font-bold">Welcome to FilmGallery</span>
              <span className="text-sm font-normal text-default-500">Choose your default workspace — you can change it anytime in Settings</span>
            </ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CARDS.map(({ choice, icon: Icon, title, desc }) => (
                  <Card
                    key={choice}
                    isPressable
                    isDisabled={busy}
                    onPress={() => handleChoice(choice)}
                    shadow="sm"
                    className="border border-zinc-200 dark:border-zinc-700 hover:border-primary"
                  >
                    <CardBody className="items-center text-center gap-2 py-6">
                      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <div className="text-lg font-semibold">{title}</div>
                      <div className="text-xs text-default-500">{desc}</div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={handleSkip} isDisabled={busy}>Skip</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
