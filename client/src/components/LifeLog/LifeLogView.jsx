/**
 * LifeLogView - Main container for Photo Calendar / Life Log
 * Orchestrates navigation, month/year views, and day modal
 */
import React from 'react';
import { format } from 'date-fns';
import { Card, CardBody, Button, Spinner } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar, LayoutGrid } from 'lucide-react';
import { LifeLogProvider, useLifeLog } from './LifeLogContext';
import LifeLogMonthGrid from './LifeLogMonthGrid';
import LifeLogYearGrid from './LifeLogYearGrid';
import LifeLogDayModal from './LifeLogDayModal';

function LifeLogContent() {
  const { 
    currentDate, 
    viewMode, 
    setViewMode, 
    handlePrev, 
    handleNext, 
    year,
    isLoading,
    error 
  } = useLifeLog();

  if (error) {
    return (
      <Card className="bg-danger-50">
        <CardBody className="p-6 text-center text-danger">
          Failed to load photos: {error.message}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Life Log</h2>
        
        {/* Navigation */}
        <Card className="bg-white dark:bg-zinc-900 shadow-none border-none">
          <CardBody className="flex flex-row items-center gap-4 py-2 px-4">
            <Button
              isIconOnly
              variant="light"
              size="sm"
              onPress={handlePrev}
              aria-label="Previous"
            >
              <ChevronLeft size={20} />
            </Button>

            <div 
              className="flex items-center gap-2 cursor-pointer select-none min-w-32 justify-center"
              onClick={() => setViewMode(viewMode === 'month' ? 'year' : 'month')}
            >
              {viewMode === 'month' ? (
                <>
                  <span className="text-lg font-semibold hover:text-primary transition-colors">
                    {format(currentDate, 'MMMM')}
                  </span>
                  <span className="text-lg font-semibold hover:text-primary transition-colors">
                    {year}
                  </span>
                </>
              ) : (
                <span className="text-lg font-semibold">{year}</span>
              )}
            </div>

            <Button
              isIconOnly
              variant="light"
              size="sm"
              onPress={handleNext}
              aria-label="Next"
            >
              <ChevronRight size={20} />
            </Button>

            <div className="w-px h-6 bg-divider mx-1" />

            {/* View Mode Toggle */}
            <div className="flex gap-1">
              <Button
                isIconOnly
                variant={viewMode === 'month' ? 'solid' : 'light'}
                color={viewMode === 'month' ? 'primary' : 'default'}
                size="sm"
                onPress={() => setViewMode('month')}
                aria-label="Month View"
              >
                <Calendar size={16} />
              </Button>
              <Button
                isIconOnly
                variant={viewMode === 'year' ? 'solid' : 'light'}
                color={viewMode === 'year' ? 'primary' : 'default'}
                size="sm"
                onPress={() => setViewMode('year')}
                aria-label="Year View"
              >
                <LayoutGrid size={16} />
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" color="primary" />
        </div>
      )}

      {/* Content */}
      {!isLoading && (
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            {viewMode === 'month' ? (
              <LifeLogMonthGrid />
            ) : (
              <LifeLogYearGrid />
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Day Detail Modal */}
      <LifeLogDayModal />
    </div>
  );
}

export default function LifeLogView({ mode }) {
  return (
    <LifeLogProvider mode={mode}>
      <div className="h-full p-6">
        <LifeLogContent />
      </div>
    </LifeLogProvider>
  );
}
