import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button,
} from '@heroui/react';
import { Film, Camera, Layers } from 'lucide-react';
import { setOnboardingChoice } from '../../api';

const CHOICES = [
  {
    key: 'film',
    title: '胶片',
    subtitle: 'Film Only',
    icon: Film,
    desc: '仅使用胶片摄影',
    config: { default_source_filter: 'film', show_film_section: 1, show_digital_section: 0, digital_enabled: 0 },
  },
  {
    key: 'digital',
    title: '数码',
    subtitle: 'Digital Only',
    icon: Camera,
    desc: '仅使用数码摄影',
    config: { default_source_filter: 'digital', show_film_section: 0, show_digital_section: 1, digital_enabled: 1 },
  },
  {
    key: 'both',
    title: '胶片 + 数码',
    subtitle: 'Both',
    icon: Layers,
    desc: '同时使用胶片和数码',
    config: { default_source_filter: 'all', show_film_section: 1, show_digital_section: 1, digital_enabled: 1 },
  },
];

export default function OnboardingModal({ appConfig }) {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  async function handleConfirm() {
    if (!selected) return;
    const choice = CHOICES.find(c => c.key === selected);
    if (!choice) return;
    setSubmitting(true);
    try {
      await setOnboardingChoice({ ...choice.config, choice: choice.key });
      await queryClient.invalidateQueries({ queryKey: ['app-config'] });
    } catch (err) {
      console.error('[Onboarding] Failed to save choice:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen
      isDismissable={false}
      closeOnPressEscape={false}
      size="lg"
      className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="text-2xl font-bold">欢迎使用 FilmGallery</span>
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">你主要使用哪种摄影方式？</span>
        </ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
            {CHOICES.map(({ key, title, subtitle, icon: Icon, desc }) => {
              const active = selected === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`
                    flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-150
                    ${active
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }
                  `}
                >
                  <div className={`
                    w-16 h-16 rounded-full flex items-center justify-center
                    ${active ? 'bg-primary text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'}
                  `}>
                    <Icon className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-lg">{title}</div>
                    <div className="text-xs text-zinc-400 dark:text-zinc-500">{subtitle}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            color="primary"
            isDisabled={!selected}
            isLoading={submitting}
            onPress={handleConfirm}
          >
            确认
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
