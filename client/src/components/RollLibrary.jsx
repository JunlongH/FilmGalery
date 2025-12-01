// src/components/RollLibrary.jsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRolls } from '../api';
import { useNavigate } from 'react-router-dom';
import RollGrid from './RollGrid';

export default function RollLibrary() {
  const nav = useNavigate();

  const { data: rolls = [], isLoading } = useQuery({
    queryKey: ['rolls'],
    queryFn: () => getRolls()
  });

  if (isLoading) return <div style={{ padding: 20 }}>Loading rolls...</div>;

  return (
    <div>
      <div className="page-header">
        <h3>Roll Library</h3>
        <div>
          <button className="btn btn-primary" onClick={() => nav('/rolls/new')}>New Roll</button>
        </div>
      </div>
      <RollGrid rolls={rolls} />
    </div>
  );
}