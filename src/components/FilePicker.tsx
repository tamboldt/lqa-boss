import React, { useState, useEffect } from 'react'
import {
  Box,
  Heading,
  Button,
  Text,
  HStack,
  Badge,
  Grid,
  Checkbox,
  Portal,
  Spinner,
  Input,
  IconButton,
} from '@chakra-ui/react'
import { FiX, FiEdit2, FiCheck, FiFolder, FiSearch } from 'react-icons/fi'

export interface PickerFile {
  id: string
  name: string
  size?: string
  updated?: string
}

export interface LocationInfo {
  // GCS location
  bucket?: string
  prefix?: string
  // GDrive location
  folderId?: string
  folderName?: string
}

interface FilePickerProps {
  title: string
  files: PickerFile[]
  loading?: boolean
  error?: string
  onFileSelect: (file: PickerFile) => void
  onRetry?: () => void
  isOpen: boolean
  onClose: () => void
  // Location handling
  location?: LocationInfo
  onLocationChange?: (location: LocationInfo) => void
  onBrowseFolders?: () => void
}

// Helper function to check if a job is done (has corresponding .json file)
const isJobDone = (files: PickerFile[], jobId: string): boolean => {
  return files.some(file => file.name === `${jobId}.json`)
}

// Helper function to extract job ID from .lqaboss filename
const extractJobId = (filename: string): string => {
  return filename.replace('.lqaboss', '')
}

const FilePicker: React.FC<FilePickerProps> = ({
  title,
  files,
  loading = false,
  error,
  onFileSelect,
  onRetry,
  isOpen,
  onClose,
  location,
  onLocationChange,
  onBrowseFolders,
}) => {
  const [showDoneJobs, setShowDoneJobs] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editBucket, setEditBucket] = useState(location?.bucket || '')
  const [editPrefix, setEditPrefix] = useState(location?.prefix || '')
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)

  // Update edit values when location changes
  useEffect(() => {
    setEditBucket(location?.bucket || '')
    setEditPrefix(location?.prefix || '')
  }, [location?.bucket, location?.prefix])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  // Determine location type
  const isGCS = !!(location?.bucket || location?.prefix)
  const isGDrive = !!location?.folderId

  // Build location display string
  const getLocationDisplay = (): string => {
    if (isGCS && location?.bucket && location?.prefix) {
      return `${location.bucket}/${location.prefix}`
    }
    if (isGDrive && location?.folderName) {
      return location.folderName
    }
    if (isGDrive && location?.folderId) {
      return location.folderId === 'root' ? 'My Drive' : location.folderId
    }
    return ''
  }

  const handleStartEdit = () => {
    setIsEditing(true)
  }

  const handleCancelEdit = () => {
    setEditBucket(location?.bucket || '')
    setEditPrefix(location?.prefix || '')
    setIsEditing(false)
  }

  const handleSaveEdit = async () => {
    if (!onLocationChange) return

    const trimmedBucket = editBucket.trim()
    const trimmedPrefix = editPrefix.trim()

    if (!trimmedBucket || !trimmedPrefix) {
      return
    }

    setIsLoadingLocation(true)
    try {
      await onLocationChange({ bucket: trimmedBucket, prefix: trimmedPrefix })
      setIsEditing(false)
    } finally {
      setIsLoadingLocation(false)
    }
  }

  // Filter and sort .lqaboss files by updated date (descending)
  let lqabossFiles = files
    .filter(file => file.name.endsWith('.lqaboss'))
    .sort((a, b) => {
      if (!a.updated || !b.updated) return 0
      return new Date(b.updated).getTime() - new Date(a.updated).getTime()
    })

  // Filter by job status if needed
  if (!showDoneJobs) {
    lqabossFiles = lqabossFiles.filter(file => {
      const jobId = extractJobId(file.name)
      return !isJobDone(files, jobId)
    })
  }

  // Filter by search text: every whitespace-separated term must appear in the file name
  // (case-insensitive). Applied before the 100-job limit so older jobs can still be found.
  const searchTerms = searchText.toLowerCase().split(/\s+/).filter(Boolean)
  if (searchTerms.length > 0) {
    lqabossFiles = lqabossFiles.filter(file => {
      const name = file.name.toLowerCase()
      return searchTerms.every(term => name.includes(term))
    })
  }

  // Limit to maximum 100 jobs
  lqabossFiles = lqabossFiles.slice(0, 100)

  const handleFileSelect = (file: PickerFile) => {
    onFileSelect(file)
    onClose()
  }

  if (!isOpen) return null

  const locationDisplay = getLocationDisplay()

  return (
    <Portal>
      {/* Overlay */}
      <Box
        position="fixed"
        top="0"
        left="0"
        right="0"
        bottom="0"
        bg="blackAlpha.600"
        backdropFilter="blur(10px)"
        zIndex="overlay"
        onClick={onClose}
      />

      {/* Modal Content */}
      <Box
        position="fixed"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        zIndex="modal"
        maxW="4xl"
        w="90%"
        maxH="80vh"
        bg="white"
        backdropFilter="blur(20px)"
        border="1px solid"
        borderColor="gray.200"
        boxShadow="xl"
        borderRadius="xl"
        overflow="hidden"
        data-testid="file-picker-modal"
      >
        {/* Header */}
        <Box
          p={6}
          borderBottom="1px solid"
          borderColor="gray.100"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
        >
          <Heading size="lg" color="gray.700">
            {title}
          </Heading>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            color="gray.500"
            _hover={{ color: "gray.700" }}
            aria-label="close modal"
          >
            <FiX size={20} />
          </Button>
        </Box>

        {/* Subheader with location and filter */}
        <Box
          px={6}
          py={4}
          borderBottom="1px solid"
          borderColor="gray.100"
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          bg="gray.50"
        >
          {/* GCS: Inline editing of bucket/prefix */}
          {isGCS && isEditing ? (
            <HStack gap={2} flex={1}>
              <Input
                size="sm"
                value={editBucket}
                onChange={(e) => setEditBucket(e.target.value)}
                placeholder="bucket-name"
                width="200px"
              />
              <Text fontSize="sm" color="gray.600">/</Text>
              <Input
                size="sm"
                value={editPrefix}
                onChange={(e) => setEditPrefix(e.target.value)}
                placeholder="path/to/folder"
                width="300px"
              />
              <IconButton
                onClick={handleSaveEdit}
                colorScheme="blue"
                size="sm"
                aria-label="Save location"
                title="Save and reload"
                loading={isLoadingLocation}
                disabled={!editBucket.trim() || !editPrefix.trim()}
              >
                <FiCheck />
              </IconButton>
              <Button
                onClick={handleCancelEdit}
                variant="ghost"
                size="sm"
                disabled={isLoadingLocation}
              >
                Cancel
              </Button>
            </HStack>
          ) : (
            <HStack gap={2}>
              <Text fontSize="sm" color="gray.600">
                {locationDisplay || 'No location set'}
              </Text>
              {/* GCS: Edit button for bucket/prefix */}
              {isGCS && onLocationChange && (
                <IconButton
                  onClick={handleStartEdit}
                  variant="ghost"
                  size="xs"
                  aria-label="Edit location"
                  title="Edit bucket and prefix"
                >
                  <FiEdit2 />
                </IconButton>
              )}
              {/* GDrive: Browse folders button */}
              {isGDrive && onBrowseFolders && (
                <IconButton
                  onClick={onBrowseFolders}
                  variant="ghost"
                  size="xs"
                  aria-label="Browse folders"
                  title="Browse folders"
                >
                  <FiFolder />
                </IconButton>
              )}
            </HStack>
          )}
          {!isEditing && (
            <Checkbox.Root
              checked={showDoneJobs}
              onCheckedChange={(details) => setShowDoneJobs(!!details.checked)}
              colorPalette="green"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Label>Show DONE jobs</Checkbox.Label>
            </Checkbox.Root>
          )}
        </Box>

        {/* Search by file name */}
        <Box px={6} py={3} borderBottom="1px solid" borderColor="gray.100">
          <HStack gap={2}>
            <FiSearch color="gray" />
            <Input
              size="sm"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by file name (e.g. rbc fr-CA)"
              aria-label="Search files by name"
            />
            {searchText && (
              <IconButton
                onClick={() => setSearchText('')}
                variant="ghost"
                size="xs"
                aria-label="Clear search"
                title="Clear search"
              >
                <FiX />
              </IconButton>
            )}
          </HStack>
        </Box>

        {/* Body */}
        <Box p={6} overflow="auto" maxH="60vh">
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" py={8}>
              <Spinner size="lg" color="blue.500" />
            </Box>
          ) : error ? (
            <Box textAlign="center" py={8}>
              <Text color="red.500">{error}</Text>
              {onRetry && (
                <Button
                  mt={4}
                  size="sm"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              )}
            </Box>
          ) : lqabossFiles.length === 0 ? (
            <Text color="gray.600" textAlign="center" py={8}>
              {searchTerms.length > 0
                ? `No .lqaboss files match "${searchText.trim()}"`
                : `No .lqaboss files found${locationDisplay ? ` in ${locationDisplay}` : ''}`}
            </Text>
          ) : (
            <Grid templateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap={4}>
              {lqabossFiles.map((file) => {
                const jobId = extractJobId(file.name)
                const isDone = isJobDone(files, jobId)

                return (
                  <Button
                    key={file.id}
                    variant="outline"
                    justifyContent="flex-start"
                    onClick={() => handleFileSelect(file)}
                    p={4}
                    height="auto"
                    whiteSpace="normal"
                    width="100%"
                    bg="white"
                    _hover={{
                      bg: "rgba(59, 130, 246, 0.1)",
                      borderColor: "blue.400",
                      transform: "translateY(-1px)",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
                    }}
                    transition="all 0.2s"
                  >
                    <Box textAlign="left" width="100%">
                      <HStack justify="space-between" align="center" mb={2}>
                        <Text fontWeight="bold" fontSize="sm" color="gray.800">
                          Job: {jobId}
                        </Text>
                        <Badge
                          colorPalette={isDone ? "green" : "orange"}
                          variant={isDone ? "solid" : "subtle"}
                          size="sm"
                        >
                          {isDone ? "DONE" : "WIP"}
                        </Badge>
                      </HStack>
                      <Text fontSize="xs" color="gray.600">
                        {file.size ? `${(parseInt(file.size) / 1024).toFixed(1)} KB` : 'Unknown size'}
                        {file.updated && ` • ${new Date(file.updated).toLocaleDateString()}`}
                      </Text>
                    </Box>
                  </Button>
                )
              })}
            </Grid>
          )}
        </Box>
      </Box>
    </Portal>
  )
}

export default FilePicker
