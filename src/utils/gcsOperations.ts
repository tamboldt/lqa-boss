export interface GCSFile {
  name: string
  fullName: string
  size: string
  updated: string
}

export interface GCSOperationsOptions {
  onTokenExpired?: () => void
}

export class GCSOperations {
  constructor(private options: GCSOperationsOptions = {}) {}

  private handleTokenExpiry(error: any): void {
    if (error.message.includes('401') || error.message.includes('Authentication expired')) {
      console.log('GCS token expired, clearing stored credentials')
      localStorage.removeItem('gcs-access-token')
      localStorage.removeItem('gcs-token-expiry')
      this.options.onTokenExpired?.()
    }
  }

  async loadFile(bucket: string, prefix: string, filename: string, token: string): Promise<File> {
    try {
      const objectName = `${prefix}/${filename}`
      const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}?alt=media`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication expired. Please sign in again.')
        }
        if (response.status === 404) {
          // Don't log 404 errors - they're often expected (e.g., checking for saved translations)
          throw new Error(`File not found: 404`)
        }
        throw new Error(`Failed to load file: ${response.status} ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const file = new File([arrayBuffer], filename, { type: 'application/octet-stream' })

      console.log(`Successfully loaded ${filename} from GCS bucket ${bucket}`)
      return file
    } catch (error: any) {
      // Only log non-404 errors to avoid console noise
      if (!error.message?.includes('404')) {
        console.error('Error loading file from GCS:', error)
      }
      this.handleTokenExpiry(error)
      throw error
    }
  }

  async saveFile(bucket: string, prefix: string, filename: string, data: any, token: string): Promise<string> {
    try {
      const jsonString = JSON.stringify(data, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const objectName = `${prefix}/${filename}`

      const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: blob
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication expired. Please sign in again.')
        }
        throw new Error(`Failed to save file: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      console.log(`Successfully saved ${filename} to GCS bucket ${bucket}`)
      return result.name
    } catch (error: any) {
      console.error('Error saving file to GCS:', error)
      this.handleTokenExpiry(error)
      throw error
    }
  }

  async saveBlobFile(bucket: string, prefix: string, filename: string, blob: Blob, token: string): Promise<string> {
    try {
      const objectName = `${prefix}/${filename}`

      const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: blob
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication expired. Please sign in again.')
        }
        throw new Error(`Failed to save blob file: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      console.log(`Successfully saved ${filename} to GCS bucket ${bucket}`)
      return result.name
    } catch (error: any) {
      console.error('Error saving blob file to GCS:', error)
      this.handleTokenExpiry(error)
      throw error
    }
  }

  async listFiles(bucket: string, prefix: string, token: string): Promise<GCSFile[]> {
    try {
      const prefixPath = `${prefix}/`
      const allFiles: GCSFile[] = []
      let pageToken: string | undefined

      // GCS returns at most 1000 objects per page in lexicographic order, so we must
      // follow nextPageToken or files sorting after the first page are silently dropped
      do {
        const params = new URLSearchParams({
          prefix: prefixPath,
          delimiter: '/',
          fields: 'items(name,size,updated),nextPageToken'
        })
        if (pageToken) {
          params.set('pageToken', pageToken)
        }

        const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Authentication expired. Please sign in again.')
          }
          throw new Error(`Failed to list files: ${response.status} ${response.statusText}`)
        }

        const result = await response.json()
        for (const item of result.items || []) {
          allFiles.push({
            name: item.name.replace(`${prefixPath}`, ''),
            fullName: item.name,
            size: item.size,
            updated: item.updated
          })
        }
        pageToken = result.nextPageToken
      } while (pageToken)

      return allFiles
    } catch (error: any) {
      console.error('Error listing GCS files:', error)
      this.handleTokenExpiry(error)
      throw error
    }
  }
}