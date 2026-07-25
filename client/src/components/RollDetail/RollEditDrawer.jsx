/**
 * RollEditDrawer - Modern slide-over drawer for editing roll metadata
 * 
 * Uses HeroUI Modal configured as a side drawer with:
 * - Accordion sections for organized content
 * - HeroUI form components (Input, Select, Textarea)
 * - Equipment selector integration
 * - Location selector integration
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
  Select,
  SelectItem,
  Chip,
  Divider,
  ScrollShadow,
  Accordion,
  AccordionItem
} from '@heroui/react';
import {
  X,
  Save,
  Calendar,
  Camera,
  Aperture,
  User,
  Film,
  MapPin,
  FileText,
  Beaker,
  ScanLine,
  DollarSign,
  Building2,
  Settings2
} from 'lucide-react';
import { getFilms, getMetadataOptions } from '../../api';
import LocationSelect from '../LocationSelect';
import EquipmentSelector from '../EquipmentSelector';

const PROCESS_PRESETS = ['C-41', 'E-6', 'BW', 'ECN-2'];

// SKILL: HeroUI transparent background pattern
const inputClassNames = {
  base: "bg-transparent",
  mainWrapper: "bg-transparent",
  inputWrapper: "h-10 min-h-10 bg-transparent shadow-none",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100"
};

const selectClassNames = {
  base: "bg-transparent",
  trigger: "h-10 min-h-10 bg-transparent shadow-none",
  innerWrapper: "bg-transparent",
  value: "text-sm text-zinc-900 dark:text-zinc-100",
  selectorIcon: "text-zinc-500 dark:text-zinc-400",
  listbox: "bg-white dark:bg-zinc-800",
  popoverContent: "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
};

const textareaClassNames = {
  base: "bg-transparent",
  inputWrapper: "bg-transparent shadow-none",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100"
};

/**
 * Section wrapper for consistent styling
 */
function FormSection({ title, icon: Icon, children }) {
  return (
    <div className="space-y-4">
      {title && (
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-medium mb-3">
          {Icon && <Icon size={18} />}
          <span>{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Form field wrapper
 */
function FormField({ label, children, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

export default function RollEditDrawer({
  isOpen,
  onClose,
  roll,
  onSave,
  isSaving = false
}) {
  // Form state
  const [editData, setEditData] = useState({});
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [availableFilms, setAvailableFilms] = useState([]);
  const [options, setOptions] = useState({ cameras: [], lenses: [], photographers: [] });
  const [selectedCamera, setSelectedCamera] = useState(null);

  // Initialize form data when roll changes
  // Use ref to avoid object-reference-trap: roll object changes reference on every
  // React Query background refetch, which would wipe unsaved edits
  const rollRef = useRef(roll);
  rollRef.current = roll;

  useEffect(() => {
    const currentRoll = rollRef.current;
    if (currentRoll && isOpen) {
      setEditData({
        title: currentRoll.title || '',
        start_date: currentRoll.start_date || '',
        end_date: currentRoll.end_date || '',
        camera_equip_id: currentRoll.camera_equip_id || null,
        lens_equip_id: currentRoll.lens_equip_id || null,
        photographer: currentRoll.photographer || '',
        film_type: currentRoll.film_type || '',
        filmId: currentRoll.filmId || currentRoll.film_id || '',
        notes: currentRoll.notes || '',
        develop_lab: currentRoll.develop_lab || '',
        develop_process: currentRoll.develop_process || '',
        develop_date: currentRoll.develop_date || '',
        purchase_cost: currentRoll.purchase_cost || '',
        develop_cost: currentRoll.develop_cost || '',
        purchase_channel: currentRoll.purchase_channel || '',
        develop_note: currentRoll.develop_note || '',
        scanner_equip_id: currentRoll.scanner_equip_id || null,
        scan_resolution: currentRoll.scan_resolution || '',
        scan_software: currentRoll.scan_software || '',
        scan_lab: currentRoll.scan_lab || '',
        scan_date: currentRoll.scan_date || '',
        scan_cost: currentRoll.scan_cost || '',
        scan_notes: currentRoll.scan_notes || ''
      });
      setSelectedLocations(Array.isArray(currentRoll.locations) ? currentRoll.locations.slice() : []);
      setSelectedCamera(null);
      
      // Fetch films and options
      Promise.all([getFilms(), getMetadataOptions()])
        .then(([films, opts]) => {
          setAvailableFilms(Array.isArray(films) ? films : []);
          setOptions(opts || { cameras: [], lenses: [], photographers: [] });
        })
        .catch(console.error);
    }
  }, [roll?.id, isOpen]);

  const updateField = useCallback((field, value) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(() => {
    onSave?.({
      ...editData,
      locations: selectedLocations.map(l => l.location_id)
    });
  }, [editData, selectedLocations, onSave]);

  const handleAddLocation = useCallback((loc) => {
    if (!loc || !loc.location_id) return;
    setSelectedLocations(prev => 
      prev.some(p => p.location_id === loc.location_id) ? prev : [...prev, loc]
    );
  }, []);

  const handleRemoveLocation = useCallback((locationId) => {
    setSelectedLocations(prev => prev.filter(l => l.location_id !== locationId));
  }, []);

  const handleCameraChange = useCallback((id, item) => {
    setSelectedCamera(item);
    setEditData(prev => ({
      ...prev,
      camera_equip_id: id,
      // If camera has fixed lens, clear lens selection
      lens_equip_id: item?.has_fixed_lens ? null : prev.lens_equip_id
    }));
  }, []);

  if (!roll) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="full"
      className="m-0 sm:m-0 h-[100dvh] max-h-[100dvh] w-full sm:w-[480px] rounded-none fixed right-0 inset-y-0"
      motionProps={{
        variants: {
          enter: { x: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
          exit: { x: "100%", opacity: 0.5, transition: { duration: 0.2, ease: "easeIn" } },
        }
      }}
      classNames={{
        wrapper: "justify-end !items-start overflow-hidden",
        base: "h-full max-h-screen rounded-none shadow-2xl bg-white dark:bg-zinc-800 border-l border-zinc-200 dark:border-zinc-700",
        header: "border-b border-zinc-200/50 dark:border-zinc-700/50 p-4",
        body: "p-0",
        footer: "border-t border-zinc-200/50 dark:border-zinc-700/50 p-4",
        backdrop: "bg-black/20 backdrop-blur-[2px]"
      }}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-3">
          <Button isIconOnly variant="light" onPress={onClose} size="sm">
            <X size={20} />
          </Button>
          <div className="flex flex-col flex-1">
            <span className="text-lg font-bold leading-tight">Edit Roll</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
              #{roll.display_seq || roll.id} · {roll.title || 'Untitled'}
            </span>
          </div>
        </ModalHeader>

        <ModalBody>
          <ScrollShadow className="h-full">
            <Accordion 
              selectionMode="multiple" 
              defaultExpandedKeys={["basic", "locations"]}
              variant="light"
              className="px-4"
            >
              {/* Basic Info Section */}
              <AccordionItem
                key="basic"
                aria-label="Basic Information"
                title={
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-medium">
                    <Settings2 size={18} />
                    <span>Basic Information</span>
                  </div>
                }
              >
                <div className="space-y-4 pb-4">
                  <FormField label="Title">
                    <Input
                      value={editData.title}
                      onValueChange={(v) => updateField('title', v)}
                      placeholder="Roll title..."
                      variant="bordered"
                      size="sm"
                      classNames={inputClassNames}
                    />
                  </FormField>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Start Date">
                      <Input
                        type="date"
                        value={editData.start_date}
                        onValueChange={(v) => updateField('start_date', v)}
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<Calendar size={14} className="text-default-400" />}
                      />
                    </FormField>
                    <FormField label="End Date">
                      <Input
                        type="date"
                        value={editData.end_date}
                        onValueChange={(v) => updateField('end_date', v)}
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<Calendar size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Camera">
                      <EquipmentSelector
                        type="camera"
                        mode="film"
                        value={editData.camera_equip_id}
                        onChange={handleCameraChange}
                        placeholder="Select camera..."
                      />
                    </FormField>
                    <FormField label="Lens">
                      {selectedCamera?.has_fixed_lens ? (
                        <div className="h-10 px-3 flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-medium text-zinc-500 dark:text-zinc-400 text-sm">
                          Fixed: {selectedCamera.fixed_lens_focal_length || 'Built-in'}
                          {selectedCamera.fixed_lens_max_aperture && ` f/${selectedCamera.fixed_lens_max_aperture}`}
                        </div>
                      ) : (
                        <EquipmentSelector
                          type="lens"
                          mode="film"
                          value={editData.lens_equip_id}
                          cameraId={editData.camera_equip_id}
                          onChange={(id) => updateField('lens_equip_id', id)}
                          placeholder="Select lens..."
                        />
                      )}
                    </FormField>
                  </div>

                  <FormField label="Photographer">
                    <Input
                      value={editData.photographer}
                      onValueChange={(v) => updateField('photographer', v)}
                      placeholder="Photographer name..."
                      variant="bordered"
                      size="sm"
                      classNames={inputClassNames}
                      startContent={<User size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      list="photographer-suggestions"
                    />
                    <datalist id="photographer-suggestions">
                      {(options.photographers || []).map((p, i) => (
                        <option key={i} value={p} />
                      ))}
                    </datalist>
                  </FormField>

                  <FormField label="Film Stock">
                    <Select
                      selectedKeys={editData.filmId ? [String(editData.filmId)] : []}
                      onSelectionChange={(keys) => {
                        const fid = [...keys][0];
                        const found = availableFilms.find(f => String(f.id) === String(fid));
                        updateField('filmId', fid);
                        updateField('film_type', found ? found.name : '');
                      }}
                      placeholder="Select film..."
                      variant="bordered"
                      size="sm"
                      classNames={selectClassNames}
                      startContent={<Film size={14} className="text-zinc-400 dark:text-zinc-500" />}
                    >
                      {availableFilms.map(f => (
                        <SelectItem key={String(f.id)} value={String(f.id)}>
                          {f.name} (ISO {f.iso})
                        </SelectItem>
                      ))}
                    </Select>
                  </FormField>

                  <FormField label="Notes">
                    <Textarea
                      value={editData.notes}
                      onValueChange={(v) => updateField('notes', v)}
                      placeholder="Additional notes..."
                      variant="bordered"
                      size="sm"
                      classNames={textareaClassNames}
                      minRows={2}
                      maxRows={4}
                    />
                  </FormField>
                </div>
              </AccordionItem>

              {/* Locations Section */}
              <AccordionItem
                key="locations"
                aria-label="Shooting Locations"
                title={
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-medium">
                    <MapPin size={18} />
                    <span>Locations</span>
                    {selectedLocations.length > 0 && (
                      <Chip size="sm" variant="flat" color="secondary" className="h-5">
                        {selectedLocations.length}
                      </Chip>
                    )}
                  </div>
                }
              >
                <div className="space-y-3 pb-4">
                  <LocationSelect
                    value={null}
                    onChange={handleAddLocation}
                  />
                  <div className="flex flex-wrap gap-2">
                    {selectedLocations.map(l => (
                      <Chip
                        key={l.location_id}
                        variant="flat"
                        color="secondary"
                        onClose={() => handleRemoveLocation(l.location_id)}
                      >
                        {l.city_name}
                      </Chip>
                    ))}
                    {selectedLocations.length === 0 && (
                      <span className="text-sm text-zinc-400 dark:text-zinc-500 italic">No locations added</span>
                    )}
                  </div>
                </div>
              </AccordionItem>

              {/* Development Section */}
              <AccordionItem
                key="development"
                aria-label="Development Info"
                title={
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 font-medium">
                    <Beaker size={18} />
                    <span>Development</span>
                  </div>
                }
              >
                <div className="space-y-4 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Lab">
                      <Input
                        value={editData.develop_lab}
                        onValueChange={(v) => updateField('develop_lab', v)}
                        placeholder="Lab name..."
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<Building2 size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      />
                    </FormField>
                    <FormField label="Process">
                      <Select
                        selectedKeys={editData.develop_process ? [editData.develop_process] : []}
                        onSelectionChange={(keys) => updateField('develop_process', [...keys][0] || '')}
                        placeholder="Select..."
                        variant="bordered"
                        size="sm"
                        classNames={selectClassNames}
                      >
                        {PROCESS_PRESETS.map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </Select>
                    </FormField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Develop Date">
                      <Input
                        type="date"
                        value={editData.develop_date}
                        onValueChange={(v) => updateField('develop_date', v)}
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                    <FormField label="Develop Cost">
                      <Input
                        type="number"
                        value={editData.develop_cost}
                        onValueChange={(v) => updateField('develop_cost', v)}
                        placeholder="0.00"
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Purchase Channel">
                      <Input
                        value={editData.purchase_channel}
                        onValueChange={(v) => updateField('purchase_channel', v)}
                        placeholder="Where purchased..."
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                    <FormField label="Purchase Cost">
                      <Input
                        type="number"
                        value={editData.purchase_cost}
                        onValueChange={(v) => updateField('purchase_cost', v)}
                        placeholder="0.00"
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      />
                    </FormField>
                  </div>

                  <FormField label="Development Notes">
                    <Textarea
                      value={editData.develop_note}
                      onValueChange={(v) => updateField('develop_note', v)}
                      placeholder="Development notes..."
                      variant="bordered"
                      classNames={textareaClassNames}
                      size="sm"
                      minRows={2}
                    />
                  </FormField>
                </div>
              </AccordionItem>

              {/* Scanning Section */}
              <AccordionItem
                key="scanning"
                aria-label="Scanning Info"
                title={
                  <div className="flex items-center gap-2 text-default-600 font-medium">
                    <ScanLine size={18} />
                    <span>Scanning</span>
                  </div>
                }
              >
                <div className="space-y-4 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Scanner">
                      <EquipmentSelector
                        type="scanner"
                        value={editData.scanner_equip_id}
                        onChange={(id) => updateField('scanner_equip_id', id)}
                        placeholder="Select scanner..."
                      />
                    </FormField>
                    <FormField label="Scan Lab">
                      <Input
                        value={editData.scan_lab}
                        onValueChange={(v) => updateField('scan_lab', v)}
                        placeholder="Lab name..."
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Scan Date">
                      <Input
                        type="date"
                        value={editData.scan_date}
                        onValueChange={(v) => updateField('scan_date', v)}
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                    <FormField label="Resolution (DPI)">
                      <Input
                        type="number"
                        value={editData.scan_resolution}
                        onValueChange={(v) => updateField('scan_resolution', v)}
                        placeholder="e.g. 3200"
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Software">
                      <Input
                        value={editData.scan_software}
                        onValueChange={(v) => updateField('scan_software', v)}
                        placeholder="e.g. SilverFast"
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                      />
                    </FormField>
                    <FormField label="Scan Cost">
                      <Input
                        type="number"
                        value={editData.scan_cost}
                        onValueChange={(v) => updateField('scan_cost', v)}
                        placeholder="0.00"
                        variant="bordered"
                        size="sm"
                        classNames={inputClassNames}
                        startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500" />}
                      />
                    </FormField>
                  </div>

                  <FormField label="Scan Notes">
                    <Textarea
                      value={editData.scan_notes}
                      onValueChange={(v) => updateField('scan_notes', v)}
                      placeholder="Scan parameters, issues..."
                      variant="bordered"
                      size="sm"
                      classNames={textareaClassNames}
                      minRows={2}
                    />
                  </FormField>
                </div>
              </AccordionItem>
            </Accordion>
          </ScrollShadow>
        </ModalBody>

        <ModalFooter className="gap-2">
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={handleSave}
            isLoading={isSaving}
            startContent={!isSaving && <Save size={16} />}
          >
            Save Changes
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
