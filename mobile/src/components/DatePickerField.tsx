import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable } from 'react-native';
import { DatePickerModal, registerTranslation } from 'react-native-paper-dates';
import { TextInput } from 'react-native-paper';
import { toISODateString } from '../utils/date';

registerTranslation('en', {
  save: 'Save',
  selectSingle: 'Select date',
  selectMultiple: 'Select dates',
  calendar: 'Calendar',
  clear: 'Clear',
} as any);

export interface DatePickerFieldProps {
  label?: string;
  value?: Date | null;
  onChange?: (date: Date) => void;
  disabled?: boolean;
}

export default function DatePickerField({ label, value, onChange, disabled }: DatePickerFieldProps) {
  const initialDate = useMemo(
    () => (value instanceof Date && !isNaN(value.getTime()) ? value : new Date()),
    [value]
  );
  const [internal, setInternal] = useState<Date>(initialDate);
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    if (value instanceof Date && !isNaN(value.getTime())) {
      const t1 = internal instanceof Date ? internal.getTime() : 0;
      const t2 = value.getTime();
      if (t1 !== t2) setInternal(value);
    }
  }, [value]);

  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={() => { if (!disabled) setOpen(true); }} disabled={!!disabled}>
        <TextInput
          mode="outlined"
          label={label}
          value={internal instanceof Date ? toISODateString(internal) : ''}
          editable={false}
          right={<TextInput.Icon icon="calendar" onPress={() => { if (!disabled) setOpen(true); }} />}
        />
      </Pressable>
      <DatePickerModal
        locale="en"
        mode="single"
        visible={open}
        date={internal}
        onDismiss={() => setOpen(false)}
        onConfirm={(params: any) => {
          setOpen(false);
          if (params.date) {
            setInternal(params.date);
            if (onChange) onChange(params.date);
          }
        }}
      />
    </View>
  );
}
