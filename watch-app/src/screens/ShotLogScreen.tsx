import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FilmItem } from '../types';
import type { RootStackParamList } from '../types/navigation';
import SelectRollStep, { FixedLensInfo } from './shotlog/SelectRollStep';
import ParamsStep, { ShotParams } from './shotlog/ParamsStep';
import LocationStep from './shotlog/LocationStep';

type ShotLogStep = 'roll' | 'params' | 'location';

const ShotLogScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [step, setStep] = useState<ShotLogStep>('roll');
  const [roll, setRoll] = useState<FilmItem | null>(null);
  const [filmName, setFilmName] = useState<string | undefined>(undefined);
  const [filmIso, setFilmIso] = useState<string | undefined>(undefined);
  const [fixedLensInfo, setFixedLensInfo] = useState<FixedLensInfo | undefined>(undefined);
  const [params, setParams] = useState<ShotParams | null>(null);

  const goBackStep = useCallback(() => {
    setStep(prev => (prev === 'location' ? 'params' : 'roll'));
  }, []);

  // Android hardware back: previous step when not on step 1, exit on step 1
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (step !== 'roll') {
          goBackStep();
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [step, goBackStep])
  );

  // Swipe-back gesture: intercept beforeRemove and go to previous step instead
  useEffect(() => {
    return navigation.addListener('beforeRemove', e => {
      if (step === 'roll') {
        return;
      }
      e.preventDefault();
      goBackStep();
    });
  }, [navigation, step, goBackStep]);

  const handleSelectRoll = (
    selectedRoll: FilmItem,
    selectedFilmName: string,
    selectedFilmIso: string | undefined,
    selectedFixedLensInfo: FixedLensInfo | undefined
  ) => {
    setRoll(selectedRoll);
    setFilmName(selectedFilmName);
    setFilmIso(selectedFilmIso);
    setFixedLensInfo(selectedFixedLensInfo);
    setStep('params');
  };

  const handleParamsNext = (shotParams: ShotParams) => {
    setParams(shotParams);
    setStep('location');
  };

  const handleSaved = () => {
    navigation.goBack();
  };

  if (step === 'params' && roll) {
    return (
      <ParamsStep
        roll={roll}
        filmName={filmName}
        filmIso={filmIso}
        fixedLensInfo={fixedLensInfo}
        onNext={handleParamsNext}
      />
    );
  }

  if (step === 'location' && roll && params) {
    return (
      <LocationStep
        roll={roll}
        filmName={filmName}
        filmIso={filmIso}
        fixedLensInfo={fixedLensInfo}
        params={params}
        onSaved={handleSaved}
      />
    );
  }

  return <SelectRollStep onSelect={handleSelectRoll} />;
};

export default ShotLogScreen;
