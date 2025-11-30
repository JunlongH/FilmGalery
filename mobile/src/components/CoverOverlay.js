import React from 'react';
import { View } from 'react-native';
import { Text, Title } from 'react-native-paper';

export default function CoverOverlay({ title, leftText, rightText, style }) {
  return (
    <View style={[{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.40)', padding: 8 }, style]}>
      {title ? <Title style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 }} numberOfLines={1}>{title}</Title> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {leftText ? <Text style={{ color: '#eee', fontSize: 12, fontWeight: '500' }} numberOfLines={1}>{leftText}</Text> : <View />}
        {rightText ? <Text style={{ color: '#eee', fontSize: 12 }} numberOfLines={1}>{rightText}</Text> : <View />}
      </View>
    </View>
  );
}
