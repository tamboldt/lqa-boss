import React, { useEffect, useRef, useMemo, useCallback } from 'react'
import { Box, Stack, Text, VStack, HStack, Flex, Menu, IconButton, Portal, Tooltip, Input, Badge } from '@chakra-ui/react'
import { FiEdit, FiHome, FiRotateCcw, FiCopy, FiTarget, FiAlertTriangle } from 'react-icons/fi'
import { Page, JobData, TranslationUnit, NormalizedItem, NormalizedPlaceholder, PlaceholderDescription, QualityAssessment } from '../types'
import { QualityModel } from '../types/qualityModel'
import NormalizedTextEditor, { NormalizedTextEditorRef } from './NormalizedTextEditor'
import { normalizedToString } from '../utils/normalizedText'
import { normalizedArraysEqual } from '../utils/normalizedComparison'

// Helper function to detect RTL languages
function isRTLLanguage(langCode: string | undefined): boolean {
  if (!langCode) return false
  const rtlLangs = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ug', 'ku', 'ckb']
  const lang = langCode.toLowerCase().split('-')[0] // Handle locales like 'ar-SA'
  return rtlLangs.includes(lang)
}

// Helper to extract placeholders with their indices
function extractPlaceholders(items: NormalizedItem[]): Array<{ index: number, placeholder: NormalizedPlaceholder }> {
  const placeholders: Array<{ index: number, placeholder: NormalizedPlaceholder }> = []
  let index = 1

  items.forEach(item => {
    if (typeof item !== 'string') {
      placeholders.push({ index, placeholder: item })
      index++
    }
  })

  return placeholders
}

// Component to display normalized text with indexed placeholders (read-only)
function NormalizedTextDisplay({
  items,
  showSample = false,
  placeholderDescriptions
}: {
  items: NormalizedItem[],
  showSample?: boolean,
  placeholderDescriptions?: { [key: string]: PlaceholderDescription }
}) {
  let placeholderIndex = 1

  return (
    <>
      {items.map((item, idx) => {
        if (typeof item === 'string') {
          // Handle newlines in the text by splitting and inserting <br> elements
          const lines = item.split('\n')
          return (
            <React.Fragment key={idx}>
              {lines.map((line, lineIdx) => (
                <React.Fragment key={lineIdx}>
                  {line}
                  {lineIdx < lines.length - 1 && <br />}
                </React.Fragment>
              ))}
            </React.Fragment>
          )
        }

        const placeholder = item as NormalizedPlaceholder
        const currentIndex = placeholderIndex++

        // Get placeholder description from notes.ph if available
        // Match using the placeholder's v value, not the visual index
        const phKey = placeholder.v
        const phDesc = placeholderDescriptions?.[phKey]

        // Build tooltip content
        let tooltipContent = `Code: ${placeholder.v}`
        if (placeholder.s) {
          tooltipContent += `\nSample: ${placeholder.s}`
        }
        if (phDesc?.desc) {
          tooltipContent += `\n\n${phDesc.desc}`
        }

        // Determine what to display in the pill
        const displayText = showSample ? (placeholder.s || placeholder.v) : currentIndex

        return (
          <Tooltip.Root key={idx} openDelay={0} closeDelay={0}>
            <Tooltip.Trigger asChild>
              <span
                style={{
                  display: 'inline-block',
                  backgroundColor: showSample ? 'rgba(255, 255, 255, 0.95)' : 'rgba(59, 130, 246, 0.15)',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: showSample ? '1px solid rgba(148, 163, 184, 0.6)' : '1px solid rgba(59, 130, 246, 0.4)',
                  fontFamily: 'monospace',
                  fontSize: '0.85em',
                  fontWeight: '600',
                  userSelect: 'none',
                  color: showSample ? 'rgba(51, 65, 85, 1)' : 'rgba(37, 99, 235, 1)',
                  whiteSpace: 'nowrap'
                }}
              >
                {displayText}
              </span>
            </Tooltip.Trigger>
            <Portal>
              <Tooltip.Positioner>
                <Tooltip.Content>
                  <Text fontSize="xs" whiteSpace="pre-line">{tooltipContent}</Text>
                </Tooltip.Content>
              </Tooltip.Positioner>
            </Portal>
          </Tooltip.Root>
        )
      })}
    </>
  )
}

interface TextSegmentEditorProps {
  page: Page | null
  jobData: JobData
  originalJobData: JobData
  savedJobData: JobData
  onTranslationUnitChange: (tu: TranslationUnit) => void
  onCandidateSelect: (guid: string, candidateIndex: number) => void
  activeSegmentGuid: string | null
  onSegmentFocus: (guid: string | null) => void
  qualityModel: QualityModel | null
  onReviewToggle: (guid: string, reviewed: boolean, sttr?: number) => void
  onSegmentFocusStart?: (guid: string) => void
  onSegmentFocusEnd?: (guid: string, wasApproved: boolean) => number | null
  onSegmentEdited?: (guid: string) => void
}

const TextSegmentEditor: React.FC<TextSegmentEditorProps> = ({
  page,
  jobData,
  originalJobData,
  savedJobData,
  onTranslationUnitChange,
  onCandidateSelect,
  activeSegmentGuid,
  onSegmentFocus,
  qualityModel,
  onReviewToggle,
  onSegmentFocusStart,
  onSegmentFocusEnd,
  onSegmentEdited,
}) => {
  const editorRefs = useRef<{ [key: number]: HTMLDivElement }>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const normalizedEditorRefs = useRef<{ [key: string]: NormalizedTextEditorRef | null }>({})
  
  // Memoize the maps to prevent unnecessary re-creation
  const tusByGuid = useMemo(() => new Map(jobData.tus.map(tu => [tu.guid, tu])), [jobData.tus])
  const originalTusByGuid = useMemo(() => new Map(originalJobData.tus.map(tu => [tu.guid, tu])), [originalJobData.tus])
  const savedTusByGuid = useMemo(() => new Map(savedJobData.tus.map(tu => [tu.guid, tu])), [savedJobData.tus])

  // Memoize expensive per-segment computations to avoid recalculating on every render
  const segmentMetadata = useMemo(() => {
    const cache = new Map()

    jobData.tus.forEach(tu => {
      const currentTu = tusByGuid.get(tu.guid)
      const originalTu = originalTusByGuid.get(tu.guid)
      const savedTu = savedTusByGuid.get(tu.guid)

      if (!currentTu || !originalTu || !savedTu) {
        cache.set(tu.guid, { state: 'original', borderColor: 'blue.500' })
        return
      }

      // Compute state once
      let state: 'original' | 'saved' | 'modified' = 'original'
      if (normalizedArraysEqual(currentTu.ntgt || [], originalTu.ntgt || [])) {
        state = 'original'
      } else if (normalizedArraysEqual(currentTu.ntgt || [], savedTu.ntgt || [])) {
        state = 'saved'
      } else {
        state = 'modified'
      }

      // Derive border color from state and review status
      const borderColor = !currentTu.ts ? 'blue.500' :
                         state === 'original' ? 'green.300' :
                         state === 'saved' ? 'yellow.400' : 'red.500'

      cache.set(tu.guid, { state, borderColor })
    })

    return cache
  }, [jobData.tus, originalJobData.tus, savedJobData.tus, tusByGuid, originalTusByGuid, savedTusByGuid])

  // Handle Esc key to deselect segment
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeSegmentGuid !== null) {
        onSegmentFocus(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeSegmentGuid, onSegmentFocus])


  // Get translation units to display - always in job file order, each TU shown only once
  // If we have page data, filter to only TUs that appear on the current page
  const translationUnitsToShow = useMemo(() => {
    if (page) {
      // Get set of guids that appear on this page
      const pageGuids = new Set(page.segments?.map(s => s.g) || [])
      // Filter jobData.tus to only those with guids on this page, preserving job file order
      return jobData.tus
        .filter(tu => pageGuids.has(tu.guid))
        .map((tu, index) => ({ tu, segmentIndex: index, segment: null }))
    }
    return jobData.tus.map((tu, index) => ({ tu, segmentIndex: index, segment: null }))
  }, [page, jobData.tus])

  // Find the index of the active segment in translationUnitsToShow
  const activeSegmentIndex = useMemo(() => {
    if (!activeSegmentGuid) return -1
    return translationUnitsToShow.findIndex(item => item.tu?.guid === activeSegmentGuid)
  }, [activeSegmentGuid, translationUnitsToShow])

  // Track previous active segment to mark as reviewed when focus changes
  const prevActiveSegmentGuidRef = useRef<string | null>(null)

  useEffect(() => {
    // Mark previous segment as reviewed when focus changes
    const prevGuid = prevActiveSegmentGuidRef.current
    if (prevGuid && prevGuid !== activeSegmentGuid) {
      // Stop the segment timer (not approved via Cmd+Enter, just focus lost)
      const sttr = onSegmentFocusEnd?.(prevGuid, false)

      const prevTu = tusByGuid.get(prevGuid)
      const originalTu = originalTusByGuid.get(prevGuid)
      if (prevTu && originalTu) {
        const isOriginal = normalizedArraysEqual(prevTu.ntgt || [], originalTu.ntgt || [])
        // Mark as reviewed if content differs from original and not already reviewed
        if (!isOriginal && !prevTu.ts) {
          const updatedTu = {
            ...prevTu,
            ts: Date.now(),
            sttr: sttr ?? undefined  // Include STTR if timer was valid
          }
          onTranslationUnitChange(updatedTu)
        }
      }
    }

    // Focus and scroll the new active segment
    const guidChanged = prevActiveSegmentGuidRef.current !== activeSegmentGuid
    prevActiveSegmentGuidRef.current = activeSegmentGuid

    // Start timer for the new active segment
    if (guidChanged && activeSegmentGuid) {
      onSegmentFocusStart?.(activeSegmentGuid)
    }

    if (guidChanged && activeSegmentGuid && activeSegmentIndex >= 0) {
      const container = scrollContainerRef.current
      const element = editorRefs.current[activeSegmentIndex]

      if (container && element) {
        // Step 1: Focus the editor first (this may trigger browser scroll)
        setTimeout(() => {
          normalizedEditorRefs.current[activeSegmentGuid]?.focus()

          // Step 2: After focus, scroll to ensure full card is visible
          // This overrides any browser scroll from focus
          setTimeout(() => {
            const containerRect = container.getBoundingClientRect()
            const elementRect = element.getBoundingClientRect()

            const elementTopRelative = elementRect.top - containerRect.top
            const elementBottomRelative = elementRect.bottom - containerRect.top

            const padding = 24

            const isAboveView = elementTopRelative < padding
            const isBelowView = elementBottomRelative > containerRect.height - padding

            if (isAboveView) {
              const scrollDelta = elementTopRelative - padding
              container.scrollTo({
                top: container.scrollTop + scrollDelta,
                behavior: 'smooth'
              })
            } else if (isBelowView) {
              const scrollDelta = elementBottomRelative - (containerRect.height - padding)
              container.scrollTo({
                top: container.scrollTop + scrollDelta,
                behavior: 'smooth'
              })
            }
          }, 50)
        }, 50)
      }
    }
  }, [activeSegmentGuid, activeSegmentIndex, tusByGuid, originalTusByGuid, onTranslationUnitChange, onSegmentFocusStart, onSegmentFocusEnd])

  const handleNormalizedChange = useCallback((guid: string, newNtgt: NormalizedItem[]) => {
    const tu = tusByGuid.get(guid)
    const originalTu = originalTusByGuid.get(guid)

    if (tu && originalTu) {
      // Notify timer that segment was edited
      onSegmentEdited?.(guid)

      // Check if content differs from original (in both old and new states)
      const wasOriginal = normalizedArraysEqual(tu.ntgt || [], originalTu.ntgt || [])
      const isOriginal = normalizedArraysEqual(newNtgt, originalTu.ntgt || [])

      // Determine new ts value
      let newTs: number | undefined

      if (!wasOriginal && !isOriginal) {
        // Content was modified and still is modified - keep existing timestamp
        newTs = tu.ts
      } else if (wasOriginal && !isOriginal) {
        // Content is being edited away from original - DON'T mark as reviewed yet
        // Will be marked when segment loses focus or user navigates away
        newTs = tu.ts
      } else if (!wasOriginal && isOriginal) {
        // Content is being edited back to original - unmark as reviewed
        newTs = undefined
      } else {
        // Content was original and still is original - preserve existing state
        newTs = tu.ts
      }

      const updatedTu = {
        ...tu,
        ntgt: newNtgt,
        ts: newTs
      }

      onTranslationUnitChange(updatedTu)
    }
  }, [tusByGuid, originalTusByGuid, onTranslationUnitChange, onSegmentEdited])

  const handleUndo = useCallback((guid: string) => {
    const savedTu = savedTusByGuid.get(guid)
    if (savedTu) {
      // Force update the editor content immediately
      normalizedEditorRefs.current[guid]?.forceUpdate(savedTu.ntgt || [])
      // Update the state as well
      onTranslationUnitChange(savedTu)
    }
  }, [savedTusByGuid, onTranslationUnitChange])

  const handleOriginal = useCallback((guid: string) => {
    const originalTu = originalTusByGuid.get(guid)
    if (originalTu) {
      // Force update the editor content immediately
      normalizedEditorRefs.current[guid]?.forceUpdate(originalTu.ntgt || [])
      // Update the state as well
      onTranslationUnitChange(originalTu)
    }
  }, [originalTusByGuid, onTranslationUnitChange])

  const handleCopySource = useCallback((guid: string) => {
    const tu = tusByGuid.get(guid)
    if (tu && tu.nsrc) {
      const sourceText = normalizedToString(tu.nsrc)
      navigator.clipboard.writeText(sourceText)
    }
  }, [tusByGuid])

  const handleCopyTarget = useCallback((guid: string) => {
    const tu = tusByGuid.get(guid)
    if (tu && tu.ntgt) {
      const targetText = normalizedToString(tu.ntgt)
      navigator.clipboard.writeText(targetText)
    }
  }, [tusByGuid])

  const handleQAChange = useCallback((guid: string, qa: QualityAssessment | undefined) => {
    const tu = tusByGuid.get(guid)
    if (tu) {
      onTranslationUnitChange({ ...tu, qa })
    }
  }, [tusByGuid, onTranslationUnitChange])

  // Three-state system for segment state - based on ntgt changes
  const getSegmentState = (guid: string): 'original' | 'saved' | 'modified' => {
    const currentTu = tusByGuid.get(guid)
    const originalTu = originalTusByGuid.get(guid)
    const savedTu = savedTusByGuid.get(guid)

    if (!currentTu || !originalTu || !savedTu) return 'original'

    // Check if current matches original translation
    if (normalizedArraysEqual(currentTu.ntgt || [], originalTu.ntgt || [])) {
      return 'original' // Matches original translation from file
    }

    // Check if current matches saved translation
    if (normalizedArraysEqual(currentTu.ntgt || [], savedTu.ntgt || [])) {
      return 'saved' // Matches saved translation (auto-save)
    }

    // Current differs from both original and saved
    return 'modified' // Has unsaved changes
  }

  // Validate QA assessment against quality model
  const getQAValidationStatus = (guid: string): { isValid: boolean, message?: string } => {
    if (!qualityModel) return { isValid: true }

    const currentTu = tusByGuid.get(guid)
    const originalTu = originalTusByGuid.get(guid)

    if (!currentTu || !originalTu) return { isValid: true }

    // Skip QA validation if this is a selected candidate (not manually edited)
    if (currentTu.candidateSelected) return { isValid: true }

    // Check if segment has been corrected
    const isCorrected = !normalizedArraysEqual(currentTu.ntgt || [], originalTu.ntgt || [])
    if (!isCorrected) return { isValid: true }

    // Segment is corrected - check QA assessment
    if (!currentTu.qa || !currentTu.qa.sev || !currentTu.qa.cat) {
      return { isValid: false, message: 'Missing quality assessment. Please select severity and category.' }
    }

    // Check if severity exists in model
    const severityExists = qualityModel.severities.some(s => s.id === currentTu.qa?.sev)
    if (!severityExists) {
      return { isValid: false, message: `Invalid severity "${currentTu.qa.sev}" - not found in current quality model.` }
    }

    // Check if category exists in model
    const [catId, subId] = currentTu.qa.cat.split('.')
    const categoryExists = qualityModel.errorCategories.some(c =>
      c.id === catId && c.subcategories.some(s => s.id === subId)
    )
    if (!categoryExists) {
      return { isValid: false, message: `Invalid category "${currentTu.qa.cat}" - not found in current quality model.` }
    }

    return { isValid: true }
  }
  
  const getSegmentBorderColor = (guid: string): string => {
    const tu = tusByGuid.get(guid)

    // Blue: Unreviewed segments
    if (!tu?.ts) {
      return 'blue.500'
    }

    // Reviewed segments - color based on state
    const state = getSegmentState(guid)
    switch (state) {
      case 'original': return 'green.300'    // Green: Reviewed, unchanged from original
      case 'saved': return 'yellow.400'      // Yellow: Reviewed, changed and saved
      case 'modified': return 'red.500'      // Red: Reviewed, changed but not saved
      default: return 'green.300'
    }
  }

  if (page && (!page.segments || page.segments.length === 0)) {
    return (
      <Text color="gray.600" textAlign="center" py={10}>
        No text segments on this page.
      </Text>
    )
  }

  if (!page && translationUnitsToShow.length === 0) {
    return (
      <Text color="gray.600" textAlign="center" py={10}>
        No translation units to display.
      </Text>
    )
  }

  return (
    <Stack
      ref={scrollContainerRef}
      direction="column"
      gap={4}
      align="stretch"
      height="100%"
      overflowY="auto"
      minWidth={0}
      maxW="100%"
      py={4}
      css={{
        // Chrome scroll performance optimizations
        willChange: 'scroll-position',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        perspective: '1000px',
        // Scrollbar styling
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-track': {
          background: 'rgba(203, 213, 225, 0.3)',
          borderRadius: '4px',
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(148, 163, 184, 0.6)',
          borderRadius: '4px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          background: 'rgba(148, 163, 184, 0.8)',
        },
      }}
    >
      {translationUnitsToShow.map((item, index) => {
        const { tu } = item
        const isActive = activeSegmentIndex === index

        if (!tu) {
          return (
            <Box key={index} p={4} bg="rgba(239, 68, 68, 0.1)" backdropFilter="blur(10px)" borderRadius="lg" border="1px solid" borderColor="rgba(239, 68, 68, 0.3)">
              <Text color="red.600">Error: No translation unit found at index {index}</Text>
            </Box>
          )
        }

        // Add defensive checks for tu properties
        const safeRid = tu.rid !== undefined ? (typeof tu.rid === 'object' ? JSON.stringify(tu.rid) : String(tu.rid)) : 'unknown'
        const safeSid = tu.sid !== undefined ? (typeof tu.sid === 'object' ? JSON.stringify(tu.sid) : String(tu.sid)) : 'unknown'
        const safeGuid = tu.guid || 'unknown'
        
        // Handle notes - check if it's an object with desc property
        let notesDesc: string | null = null
        let placeholderDescriptions: { [key: string]: PlaceholderDescription } | undefined = undefined
        if (tu.notes) {
          if (typeof tu.notes === 'object') {
            if ('desc' in tu.notes && tu.notes.desc && tu.notes.desc.trim()) {
              notesDesc = tu.notes.desc
            }
            if ('ph' in tu.notes && tu.notes.ph) {
              placeholderDescriptions = tu.notes.ph
            }
          } else if (typeof tu.notes === 'string') {
            // Legacy string notes - don't show in the info line anymore
            notesDesc = tu.notes
          }
        }

        // Use cached metadata instead of expensive function calls
        const metadata = segmentMetadata.get(tu.guid) || { state: 'original', borderColor: 'blue.500' }
        const segmentState = metadata.state
        const segmentBorderColor = metadata.borderColor

        const qaValidation = getQAValidationStatus(tu.guid)

        // Extract placeholders from source for mapping display
        const placeholders = tu.nsrc ? extractPlaceholders(tu.nsrc) : []

        // Get background color based on whether segment has been corrected
        const isCorrected = segmentState !== 'original'

        const getInactiveBg = () => {
          if (isCorrected) return 'rgba(251, 146, 60, 0.3)' // light orange for all corrected segments
          return 'rgba(147, 197, 253, 0.3)' // light blue for unchanged
        }

        const getHoverBg = () => {
          if (isCorrected) return 'rgba(251, 146, 60, 0.4)' // slightly darker orange on hover
          return 'rgba(147, 197, 253, 0.4)' // slightly darker blue on hover
        }

        return (
          <Box
            key={index}
            ref={(el: HTMLDivElement | null) => {
              if (el) editorRefs.current[index] = el
            }}
            position="relative"
            p={isActive ? 6 : 4}
            bg={isActive ? 'rgba(255, 255, 255, 0.95)' : getInactiveBg()}
            css={{
              willChange: isActive ? 'transform' : 'auto',
              backfaceVisibility: 'hidden',
              contentVisibility: 'auto',
              containIntrinsicSize: '0 200px',
            }}
            borderRadius="lg"
            border="1px solid"
            borderColor={isActive ? 'rgba(59, 130, 246, 0.6)' : 'rgba(255, 255, 255, 0.2)'}
            borderLeftWidth="4px"
            borderLeftColor={segmentBorderColor}
            boxShadow={isActive ? '0 8px 24px 0 rgba(59, 130, 246, 0.3)' : '0 2px 8px 0 rgba(0, 0, 0, 0.2)'}
            transform={isActive ? 'scale(1)' : 'scale(0.99)'}
            transition="transform 0.2s ease-in-out"
            onClick={() => onSegmentFocus(tu.guid)}
            cursor="pointer"
            minWidth={0}
            maxW="100%"
            _hover={{
              bg: isActive ? 'rgba(255, 255, 255, 1)' : getHoverBg(),
              borderColor: segmentBorderColor,
              transform: isActive ? 'scale(1) translateY(-1px)' : 'scale(0.99) translateY(-1px)',
              boxShadow: isActive ? '0 8px 16px 0 rgba(59, 130, 246, 0.4)' : '0 4px 8px 0 rgba(0, 0, 0, 0.4)',
            }}
          >
            {/* Warning Icon - Visible in all states */}
            {!qaValidation.isValid && (
              <Tooltip.Root openDelay={0} closeDelay={0}>
                <Tooltip.Trigger asChild>
                  <Box
                    position="absolute"
                    top="50%"
                    right="8px"
                    transform="translateY(-50%)"
                    p={1}
                    bg="yellow.400"
                    borderRadius="sm"
                    display="flex"
                    alignItems="center"
                    zIndex={10}
                    onClick={(e) => e.stopPropagation()}
                    boxShadow="0 2px 4px rgba(0,0,0,0.2)"
                  >
                    <FiAlertTriangle size={18} color="black" />
                  </Box>
                </Tooltip.Trigger>
                <Portal>
                  <Tooltip.Positioner>
                    <Tooltip.Content>
                      <Text fontSize="xs">{qaValidation.message}</Text>
                    </Tooltip.Content>
                  </Tooltip.Positioner>
                </Portal>
              </Tooltip.Root>
            )}
            {isActive ? (
              <VStack align="stretch" gap={3} pr={!qaValidation.isValid ? "48px" : undefined}>
                <HStack justify="space-between">
                  <HStack>
                    <Box p={2} bg="gray.100" borderRadius="md" maxW="100%">
                      <Text fontSize="sm" color="gray.700" fontWeight="normal">
                        {tu.nsrc ? <NormalizedTextDisplay items={tu.nsrc} placeholderDescriptions={placeholderDescriptions} /> : '(no source text)'}
                      </Text>
                    </Box>
                  </HStack>
                  <HStack gap={2}>
                    <Badge
                      bg={tu.ts ? 'green.500' : 'orange.500'}
                      color="white"
                      px={2}
                      py={1}
                      borderRadius="md"
                      fontSize="xs"
                      fontWeight="bold"
                      cursor="pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReviewToggle(tu.guid, !tu.ts)
                      }}
                      _hover={{
                        opacity: 0.8
                      }}
                    >
                      {tu.ts ? 'REVIEWED' : 'TO REVIEW'}
                    </Badge>
                    <Menu.Root>
                    <Menu.Trigger asChild>
                      <IconButton
                        aria-label="Edit options"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FiEdit />
                      </IconButton>
                    </Menu.Trigger>
                    <Portal>
                      <Menu.Positioner zIndex={9999}>
                        <Menu.Content>
                          {/* Informational labels */}
                          {(() => {
                            const originalTu = originalTusByGuid.get(tu.guid)
                            return (originalTu?.translationProvider || originalTu?.q !== undefined || originalTu?.ts || tu.ts) && (
                              <>
                                <Box px={3} py={2} fontSize="xs" color="gray.600">
                                  {originalTu?.translationProvider && (
                                    <Text fontWeight="medium">
                                      Provider: {originalTu.translationProvider}
                                    </Text>
                                  )}
                                  {originalTu?.q !== undefined && (
                                    <Text fontWeight="medium">
                                      Quality: {originalTu.q}
                                    </Text>
                                  )}
                                  {originalTu?.ts && (
                                    <Text>
                                      Created: {new Date(originalTu.ts).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </Text>
                                  )}
                                  {tu.ts && (
                                    <Text>
                                      Reviewed: {new Date(tu.ts).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </Text>
                                  )}
                                </Box>
                                <Menu.Separator />
                              </>
                            )
                          })()}
                          <Menu.Item
                            value="original"
                            disabled={segmentState === 'original'}
                            onClick={() => handleOriginal(tu.guid)}
                          >
                            <FiHome />
                            Reset to original
                          </Menu.Item>
                          <Menu.Item
                            value="undo"
                            disabled={segmentState === 'original' || segmentState === 'saved'}
                            onClick={() => handleUndo(tu.guid)}
                          >
                            <FiRotateCcw />
                            Reset to saved
                          </Menu.Item>
                          <Menu.Item
                            value="copy-source"
                            onClick={() => handleCopySource(tu.guid)}
                          >
                            <FiCopy />
                            Copy source
                          </Menu.Item>
                          <Menu.Item
                            value="copy-target"
                            onClick={() => handleCopyTarget(tu.guid)}
                          >
                            <FiTarget />
                            Copy target
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                    </Portal>
                  </Menu.Root>
                  </HStack>
                </HStack>
                {/* Candidate Picker - shown when multiple translation candidates exist */}
                {tu.candidates && tu.candidates.length > 0 ? (
                  <Box
                    p={4}
                    bg="rgba(255, 193, 7, 0.15)"
                    borderRadius="md"
                    border="2px solid"
                    borderColor="rgba(255, 193, 7, 0.5)"
                  >
                    <Text fontSize="sm" fontWeight="bold" color="orange.800" mb={3}>
                      Multiple translation candidates found. Select one to continue:
                    </Text>
                    <VStack align="stretch" gap={2}>
                      {tu.candidates.map((candidate, idx) => (
                        <Box
                          key={idx}
                          p={3}
                          bg="white"
                          borderRadius="md"
                          border="2px solid"
                          borderColor="gray.300"
                          cursor="pointer"
                          _hover={{
                            borderColor: 'blue.500',
                            boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.5)'
                          }}
                          onClick={() => onCandidateSelect(tu.guid, idx)}
                          dir={isRTLLanguage(jobData.targetLang) ? 'rtl' : 'ltr'}
                        >
                          <Text fontSize="sm" color="gray.800">
                            <NormalizedTextDisplay items={candidate} placeholderDescriptions={placeholderDescriptions} />
                          </Text>
                        </Box>
                      ))}
                    </VStack>
                  </Box>
                ) : (
                  <NormalizedTextEditor
                    key={tu.guid}
                    ref={(ref) => {
                      normalizedEditorRefs.current[tu.guid] = ref
                    }}
                    normalizedContent={tu.ntgt || []}
                    sourceContent={tu.nsrc}
                    onChange={(newNtgt) => handleNormalizedChange(tu.guid, newNtgt)}
                    isActive={isActive}
                    placeholderDescriptions={placeholderDescriptions}
                    segmentState={segmentState}
                  />
                )}
                {/* QA Fields */}
                {qualityModel && segmentState !== 'original' && (
                  <VStack align="stretch" gap={2}>
                    {!qaValidation.isValid && (
                      <Box
                        p={2}
                        bg="rgba(251, 146, 60, 0.1)"
                        borderRadius="md"
                        border="1px solid"
                        borderColor="orange.400"
                      >
                        <HStack gap={2}>
                          <FiAlertTriangle color="orange" />
                          <Text fontSize="xs" color="orange.700" fontWeight="semibold">
                            {qaValidation.message}
                          </Text>
                        </HStack>
                      </Box>
                    )}
                    <HStack
                      gap={2}
                      p={2}
                      bg={isCorrected ? 'rgba(251, 146, 60, 0.15)' : 'rgba(147, 197, 253, 0.15)'}
                      borderRadius="md"
                      border="1px solid"
                      borderColor={isCorrected ? 'rgba(251, 146, 60, 0.4)' : 'rgba(147, 197, 253, 0.4)'}
                      flexWrap="wrap"
                      alignItems="center"
                    >
                    <HStack flex="0 1 auto" minW="fit-content" gap={2} alignItems="center">
                      {qualityModel.severities.map(severity => (
                        <Tooltip.Root key={severity.id} openDelay={300} closeDelay={0}>
                          <Tooltip.Trigger asChild>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>
                              <input
                                type="radio"
                                name={`severity-${tu.guid}`}
                                value={severity.id}
                                checked={tu.qa?.sev === severity.id}
                                onChange={(e) => {
                                  const sev = e.target.value
                                  const weight = severity.weight
                                  const currentQa = tu.qa || {}
                                  const newQa: QualityAssessment = { ...currentQa }

                                  // Set or remove sev and w based on whether severity is selected
                                  if (sev) {
                                    newQa.sev = sev
                                    newQa.w = weight
                                  } else {
                                    delete newQa.sev
                                    delete newQa.w
                                  }

                                  // Only keep qa if at least sev or cat is set
                                  handleQAChange(tu.guid, (newQa.sev || newQa.cat) ? newQa : undefined)
                                }}
                                style={{ marginRight: '4px' }}
                              />
                              {severity.label}
                            </label>
                          </Tooltip.Trigger>
                          <Portal>
                            <Tooltip.Positioner>
                              <Tooltip.Content>
                                <Text fontSize="xs" whiteSpace="pre-line">
                                  Weight: {severity.weight}
                                  {severity.description && `\n\n${severity.description}`}
                                </Text>
                              </Tooltip.Content>
                            </Tooltip.Positioner>
                          </Portal>
                        </Tooltip.Root>
                      ))}
                    </HStack>
                    <Box flex="1" minW="150px">
                      <Tooltip.Root openDelay={300} closeDelay={0}>
                        <Tooltip.Trigger asChild>
                          <select
                            key={`cat-${tu.guid}`}
                            value={tu.qa?.cat || ''}
                            onChange={(e) => {
                              const cat = e.target.value
                              const currentQa = tu.qa || {}
                              const newQa: QualityAssessment = { ...currentQa }

                              // Set or remove cat based on whether category is selected
                              if (cat) {
                                newQa.cat = cat
                              } else {
                                delete newQa.cat
                              }

                              // Only keep qa if at least sev or cat is set
                              handleQAChange(tu.guid, (newQa.sev || newQa.cat) ? newQa : undefined)
                            }}
                            style={{
                              width: '100%',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              border: '1px solid #E2E8F0',
                              fontSize: '12px',
                              color: '#1A202C',
                              backgroundColor: 'white'
                            }}
                          >
                            <option value="">-- Select Category --</option>
                            {qualityModel.errorCategories.map(category => (
                              <React.Fragment key={category.id}>
                                {category.subcategories.map(sub => (
                                  <option key={`${category.id}.${sub.id}`} value={`${category.id}.${sub.id}`}>
                                    {category.label} → {sub.label}
                                  </option>
                                ))}
                              </React.Fragment>
                            ))}
                          </select>
                        </Tooltip.Trigger>
                        <Portal>
                          <Tooltip.Positioner>
                            <Tooltip.Content>
                              <Text fontSize="xs" whiteSpace="pre-line">
                                {tu.qa?.cat && (() => {
                                  const [catId, subId] = tu.qa.cat.split('.')
                                  const category = qualityModel.errorCategories.find(c => c.id === catId)
                                  const subcategory = category?.subcategories.find(s => s.id === subId)
                                  return subcategory?.description || ''
                                })()}
                              </Text>
                            </Tooltip.Content>
                          </Tooltip.Positioner>
                        </Portal>
                      </Tooltip.Root>
                    </Box>
                    <Box flex="2" minW="200px">
                      <Input
                        size="xs"
                        value={tu.qa?.notes || ''}
                        onChange={(e) => {
                          const notes = e.target.value
                          const currentQa = tu.qa || {}
                          const newQa: QualityAssessment = { ...currentQa }

                          // Set or remove notes based on whether it's non-empty
                          if (notes) {
                            newQa.notes = notes
                          } else {
                            delete newQa.notes
                          }

                          // Only keep qa if at least sev, cat, or notes is set
                          handleQAChange(tu.guid, (newQa.sev || newQa.cat || newQa.notes) ? newQa : undefined)
                        }}
                        placeholder="Notes (optional)"
                        fontSize="xs"
                        color="gray.900"
                        bg="white"
                      />
                    </Box>
                  </HStack>
                  {/* QA Summary Footnote */}
                  {(tu.qa?.sev || tu.qa?.cat) && (
                    <Text fontSize="2xs" color="gray.500" px={2}>
                      {(() => {
                        const sentences: string[] = []

                        // Add severity description
                        if (tu.qa?.sev) {
                          const severity = qualityModel.severities.find(s => s.id === tu.qa?.sev)
                          if (severity?.description) {
                            sentences.push(severity.description)
                          }
                        }

                        // Add category description
                        if (tu.qa?.cat) {
                          const [catId, subId] = tu.qa.cat.split('.')
                          const category = qualityModel.errorCategories.find(c => c.id === catId)
                          const subcategory = category?.subcategories.find(s => s.id === subId)
                          if (subcategory?.description) {
                            sentences.push(subcategory.description)
                          }
                        }

                        return sentences.join(' ')
                      })()}
                    </Text>
                  )}
                  </VStack>
                )}
                {/* Placeholder Mapping */}
                {placeholders.length > 0 && (
                  <Box
                    p={3}
                    bg="rgba(255, 193, 7, 0.1)"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="rgba(255, 193, 7, 0.3)"
                  >
                    <Text fontSize="xs" color="gray.800" fontWeight="semibold" mb={2}>
                      Placeholders:
                    </Text>
                    <Box
                      display="grid"
                      gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))"
                      gap={2}
                    >
                      {placeholders.map(({ index, placeholder }) => {
                        // Match using the placeholder's v value, not the visual index
                        const phKey = placeholder.v
                        const phDesc = placeholderDescriptions?.[phKey]
                        return (
                          <Text key={index} fontSize="xs" color="gray.700">
                            <span style={{
                              display: 'inline-block',
                              backgroundColor: 'rgba(59, 130, 246, 0.15)',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              border: '1px solid rgba(59, 130, 246, 0.4)',
                              fontSize: '0.85em',
                              fontWeight: '600',
                              color: 'rgba(37, 99, 235, 1)',
                              marginRight: '6px'
                            }}>
                              {index}
                            </span>
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: '600',
                              color: 'rgba(71, 85, 105, 1)'
                            }}>
                              {placeholder.v}
                            </span>
                            {phDesc?.desc && (
                              <span style={{ fontWeight: 'normal' }}>
                                {' - '}{phDesc.desc}
                              </span>
                            )}
                            {placeholder.s && (
                              <span style={{ fontWeight: 'normal' }}>
                                {' (e.g. '}{placeholder.s}{')'}
                              </span>
                            )}
                          </Text>
                        )
                      })}
                    </Box>
                  </Box>
                )}
                {/* Notes */}
                {notesDesc && (
                  <Box
                    p={3}
                    bg="rgba(255, 193, 7, 0.1)"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="rgba(255, 193, 7, 0.3)"
                  >
                    <Text fontSize="xs" color="gray.800" fontWeight="normal" mb={1}>
                      Notes:
                    </Text>
                    <Text fontSize="xs" color="gray.700" fontWeight="normal">
                      {notesDesc}
                    </Text>
                  </Box>
                )}
                <Flex gap={2} justify="flex-end" align="center" color="gray.600" fontSize="xs" wrap="wrap" rowGap={1}>
                  <Text fontWeight="normal"><Text as="span" fontWeight="normal">rid:</Text> {safeRid}</Text>
                  <Text fontWeight="normal"><Text as="span" fontWeight="normal">sid:</Text> {safeSid}</Text>
                  <Text fontWeight="normal"><Text as="span" fontWeight="normal">guid:</Text> {safeGuid}</Text>
                </Flex>
              </VStack>
            ) : (
              <Box pr={!qaValidation.isValid ? "48px" : undefined}>
                {tu.candidates && tu.candidates.length > 0 ? (
                  <HStack gap={2} align="center">
                    <Box
                      p={1}
                      bg="rgba(255, 193, 7, 0.2)"
                      borderRadius="sm"
                      display="flex"
                      alignItems="center"
                    >
                      <FiAlertTriangle size={16} color="orange" />
                    </Box>
                    <Text color="orange.700" fontSize="sm" lineHeight="1.4" fontWeight="semibold">
                      Multiple translation candidates available ({tu.candidates.length} options)
                    </Text>
                  </HStack>
                ) : (
                  <Text
                    color="gray.700"
                    fontSize="sm"
                    lineHeight="1.4"
                    fontWeight="normal"
                    dir={isRTLLanguage(jobData.targetLang) ? 'rtl' : 'ltr'}
                  >
                    {tu.ntgt ? <NormalizedTextDisplay items={tu.ntgt} showSample={true} placeholderDescriptions={placeholderDescriptions} /> : '(no target text)'}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}

export default TextSegmentEditor 