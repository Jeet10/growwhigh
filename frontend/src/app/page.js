'use client'

import { useEffect, useMemo, useState } from 'react'
import BrandLogo from './BrandLogo'
import { supabase } from '../lib/supabaseClient'
import AuthScreen from '../features/ledger/components/AuthScreen'
import DeletedHistoryModal from '../features/ledger/components/DeletedHistoryModal'
import ProfileModal from '../features/ledger/components/ProfileModal'
import ThemeSwitcher, { DEFAULT_THEME, isValidTheme } from '../features/ledger/components/ThemeSwitcher'
import { fetchDeletedTransactions, fetchMembers, fetchRestoreEvents, fetchTransactions, fetchLedgerSummary } from '../features/ledger/services/ledgerService'
import { downloadFilteredExcel, downloadFilteredPdf } from '../features/ledger/utils/exportUtils'
import {
  datePresetOptions,
  formatDate,
  formatFilterDate,
  formatMoney,
  formatRelativeRestoreWindow,
  getDatePresetRange,
  getOrgLabel,
  getSuggestedNotes,
  normalizeTransaction,
  toDateTimeLocalValue,
  toUTCString,
  typeFilterOptions,
} from '../features/ledger/utils/ledgerUtils'

const PAGE_SIZE = 200;

export default function Home() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME

    const savedTheme =
      window.localStorage.getItem('growwhigh-theme') ||
      window.localStorage.getItem('growhigh-theme') ||
      window.localStorage.getItem('ledgerly-theme')
    if (isValidTheme(savedTheme)) return savedTheme
    if (savedTheme === 'dark') return 'midnight'
    if (savedTheme === 'light') return 'daylight'
    return DEFAULT_THEME
  })
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Pagination States
  const [transactionsOffset, setTransactionsOffset] = useState(0)
  const [totalTransactionsCount, setTotalTransactionsCount] = useState(0)
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false)

  const [deletedOffset, setDeletedOffset] = useState(0)
  const [totalDeletedCount, setTotalDeletedCount] = useState(0)
  const [loadingMoreDeleted, setLoadingMoreDeleted] = useState(false)

  // 100% Accurate Global Summary State
  const [summary, setSummary] = useState({
    totalIn: 0,
    totalOut: 0,
    currentBalance: 0,
    openingBalance: 0,
    transactionCount: 0,
  })

  const [allTransactions, setAllTransactions] = useState([])
  const [deletedTransactions, setDeletedTransactions] = useState([])
  const [restoreEvents, setRestoreEvents] = useState([])
  const [members, setMembers] = useState([])
  const [selectedMemberName, setSelectedMemberName] = useState('')
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showDeletedHistoryModal, setShowDeletedHistoryModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [orgLogoUrl, setOrgLogoUrl] = useState(null)
  const [hasOrgLogo, setHasOrgLogo] = useState(false)
  const [selectedTransactionIds, setSelectedTransactionIds] = useState([])
  const [selectedDeletedTransactionIds, setSelectedDeletedTransactionIds] = useState([])
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [transactionDate, setTransactionDate] = useState('')

  const [filterDatePreset, setFilterDatePreset] = useState('all')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')
  const [filterNote, setFilterNote] = useState('')
  const [filterMemberName, setFilterMemberName] = useState('all')
  const [filterTransactionType, setFilterTransactionType] = useState('all')

  const [newMember, setNewMember] = useState('')

  const [authMode, setAuthMode] = useState('sign-in')
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('growwhigh-theme', theme)
  }, [theme])

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (mounted) {
        setSession(currentSession)
        setAuthLoading(false)
      }
    }

    bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user?.id) {
      setOrgLogoUrl(null)
      setHasOrgLogo(false)
      return
    }

    const loadOrgLogo = async () => {
      const fileName = `${session.user.id}/logo.png`
      const { data: { publicUrl } } = supabase.storage
        .from('org-logos')
        .getPublicUrl(fileName)
      
      const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`
      
      try {
        const response = await fetch(cacheBustedUrl, { 
          method: 'HEAD',
          cache: 'no-cache'
        })
        if (response.ok && response.status === 200) {
          setOrgLogoUrl(publicUrl)
          setHasOrgLogo(true)
        } else {
          setOrgLogoUrl(null)
          setHasOrgLogo(false)
        }
      } catch {
        setOrgLogoUrl(null)
        setHasOrgLogo(false)
      }
    }

    loadOrgLogo()
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id) {
      setAllTransactions([])
      setDeletedTransactions([])
      setRestoreEvents([])
      setMembers([])
      setSelectedMemberName('')
      return
    }

    loadWorkspace(session.user.id)
  }, [session?.user?.id])

  useEffect(() => {
    if (filterMemberName === 'all') return
    if (members.some(member => member.name === filterMemberName)) return
    setFilterMemberName('all')
  }, [filterMemberName, members])

  const handleError = message => {
    setError(message)
    window.clearTimeout(handleError.timeoutId)
    handleError.timeoutId = window.setTimeout(() => setError(''), 4500)
  }

  const openConfirmDialog = config => {
    setConfirmDialog({
      tone: 'default',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      ...config,
    })
  }

  const closeConfirmDialog = () => {
    if (confirmSubmitting) return
    setConfirmDialog(null)
  }

  const runConfirmedAction = async () => {
    if (!confirmDialog?.onConfirm) return

    setConfirmSubmitting(true)
    try {
      await confirmDialog.onConfirm()
      setConfirmDialog(null)
    } catch (confirmError) {
      handleError(confirmError?.message || 'Unable to complete this action.')
    } finally {
      setConfirmSubmitting(false)
    }
  }

  const loadWorkspace = async userId => {
    setLoading(true)
    await Promise.all([
      loadTransactions(userId, false), 
      loadDeletedTransactions(userId, false), 
      loadRestoreEvents(userId), 
      loadMembers(userId)
    ])
    setLoading(false)
  }

  const loadTransactions = async (userId, isLoadMore = false) => {
    if (isLoadMore) setLoadingMoreTransactions(true)
    else setLoading(true)
    
    const newOffset = isLoadMore ? transactionsOffset + PAGE_SIZE : 0;
    
    const currentFilters = {
      type: filterTransactionType,
      memberName: filterMemberName,
      noteSearch: filterNote,
      ...getDatePresetRange(filterDatePreset, filterStartDate, filterEndDate)
    }

    try {
      // 1. Fetch Paginated Transactions
      const { data, count, error: queryError } = await fetchTransactions(userId, newOffset, newOffset + PAGE_SIZE - 1, currentFilters)

      if (queryError) {
        handleError('Unable to load transactions.')
        if (!isLoadMore) setAllTransactions([])
      } else {
        const normalized = (data || []).map(normalizeTransaction)
        if (isLoadMore) {
          setAllTransactions(prev => [...prev, ...normalized])
        } else {
          setAllTransactions(normalized)
        }
        setTransactionsOffset(newOffset)
        if (count !== null) setTotalTransactionsCount(count)
      }

      // 2. Fetch True Global Summary (only needed on fresh loads)
      if (!isLoadMore) {
        const summaryData = await fetchLedgerSummary(userId, currentFilters);
        if (summaryData) setSummary(summaryData);
      }
    } catch (err) {
      console.error(err);
      handleError('Error fetching data.');
    } finally {
      if (isLoadMore) setLoadingMoreTransactions(false)
      else setLoading(false)
    }
  }

  // Trigger search when filters change
  useEffect(() => {
    if (!session?.user?.id) return;
    
    const delayDebounceFn = setTimeout(() => {
      loadTransactions(session.user.id, false);
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [filterDatePreset, filterStartDate, filterEndDate, filterNote, filterMemberName, filterTransactionType])

  const loadDeletedTransactions = async (userId, isLoadMore = false) => {
    if (isLoadMore) setLoadingMoreDeleted(true)

    const newOffset = isLoadMore ? deletedOffset + PAGE_SIZE : 0;
    const { data, count, error: queryError } = await fetchDeletedTransactions(userId, newOffset, newOffset + PAGE_SIZE - 1)

    if (queryError) {
      handleError('Unable to load deleted transaction history.')
      if (!isLoadMore) setDeletedTransactions([])
    } else {
      const normalized = (data || []).map(normalizeTransaction)
      if (isLoadMore) {
        setDeletedTransactions(prev => [...prev, ...normalized])
      } else {
        setDeletedTransactions(normalized)
      }
      setDeletedOffset(newOffset)
      if (count !== null) setTotalDeletedCount(count)
    }
    
    if (isLoadMore) setLoadingMoreDeleted(false)
  }

  const loadRestoreEvents = async userId => {
    const { data, error: queryError } = await fetchRestoreEvents(userId)

    if (queryError) {
      handleError('Unable to load restore activity.')
      setRestoreEvents([])
      return
    }

    setRestoreEvents((data || []).map(normalizeTransaction))
  }

  const loadMembers = async userId => {
    const { data, error: queryError } = await fetchMembers(userId)

    if (queryError) {
      handleError('Unable to load members. Check your Supabase tables and policies.')
      setMembers([])
      return
    }

    setMembers(data || [])
    setSelectedMemberName(currentMember => {
      if (!data?.length) return ''
      if (currentMember && data.some(member => member.name === currentMember)) return currentMember
      return data[0].name
    })
  }

  const visibleTransactionIds = useMemo(
    () => allTransactions.map(transaction => transaction.id),
    [allTransactions]
  )
  const selectedVisibleTransactionIds = useMemo(
    () => visibleTransactionIds.filter(transactionId => selectedTransactionIds.includes(transactionId)),
    [selectedTransactionIds, visibleTransactionIds]
  )
  const allVisibleTransactionsSelected =
    visibleTransactionIds.length > 0 && selectedVisibleTransactionIds.length === visibleTransactionIds.length
  
  const visibleDeletedTransactionIds = useMemo(
    () => deletedTransactions.map(transaction => transaction.id),
    [deletedTransactions]
  )
  const selectedVisibleDeletedTransactionIds = useMemo(
    () => visibleDeletedTransactionIds.filter(transactionId => selectedDeletedTransactionIds.includes(transactionId)),
    [selectedDeletedTransactionIds, visibleDeletedTransactionIds]
  )
  const allVisibleDeletedTransactionsSelected =
    visibleDeletedTransactionIds.length > 0 &&
    selectedVisibleDeletedTransactionIds.length === visibleDeletedTransactionIds.length

  useEffect(() => {
    const activeTransactionIds = new Set(allTransactions.map(transaction => transaction.id))
    setSelectedTransactionIds(currentIds => currentIds.filter(transactionId => activeTransactionIds.has(transactionId)))
  }, [allTransactions])

  useEffect(() => {
    const activeDeletedTransactionIds = new Set(deletedTransactions.map(transaction => transaction.id))
    setSelectedDeletedTransactionIds(currentIds =>
      currentIds.filter(transactionId => activeDeletedTransactionIds.has(transactionId))
    )
  }, [deletedTransactions])

  const activeFilterCount = [
    filterDatePreset !== 'all',
    filterTransactionType !== 'all',
    filterMemberName !== 'all',
    Boolean(filterNote.trim()),
  ].filter(Boolean).length

  const activeRange = getDatePresetRange(filterDatePreset, filterStartDate, filterEndDate)
  const filterSummaryLabel =
    filterDatePreset === 'custom'
      ? [activeRange.startDate ? formatFilterDate(activeRange.startDate) : '', activeRange.endDate ? formatFilterDate(activeRange.endDate) : '']
          .filter(Boolean)
          .join(' - ') || 'Custom range'
      : datePresetOptions.find(option => option.value === filterDatePreset)?.label || 'All'

  const clearFilters = () => {
    setFilterDatePreset('all')
    setFilterStartDate('')
    setFilterEndDate('')
    setFilterNote('')
    setFilterMemberName('all')
    setFilterTransactionType('all')
  }

  const savedNoteOptions = useMemo(() => {
    const noteCounts = new Map()

    allTransactions.forEach(transaction => {
      const trimmedNote = transaction.note?.trim()
      if (!trimmedNote) return

      const normalizedNote = trimmedNote.toLowerCase()
      const currentEntry = noteCounts.get(normalizedNote)

      if (currentEntry) {
        currentEntry.count += 1
        return
      }

      noteCounts.set(normalizedNote, {
        value: trimmedNote,
        normalized: normalizedNote,
        count: 1,
      })
    })

    return Array.from(noteCounts.values())
  }, [allTransactions])

  const noteSuggestions = useMemo(() => getSuggestedNotes(savedNoteOptions, note), [note, savedNoteOptions])
  const editNoteSuggestions = useMemo(
    () => getSuggestedNotes(savedNoteOptions, editingTransaction?.note || ''),
    [editingTransaction?.note, savedNoteOptions]
  )

  const exportFileBaseName = useMemo(() => {
    const dateSegment = filterDatePreset === 'custom' ? filterSummaryLabel.replaceAll(' ', '-').replaceAll('/', '-') : filterDatePreset
    const memberSegment = filterMemberName === 'all' ? 'all-members' : filterMemberName.toLowerCase().replace(/\s+/g, '-')
    const typeSegment = filterTransactionType === 'all' ? 'all-cashflow' : `cash-${filterTransactionType}`
    return `growwhigh-${dateSegment}-${memberSegment}-${typeSegment}`
  }, [filterDatePreset, filterMemberName, filterSummaryLabel, filterTransactionType])

  const exportRows = useMemo(
    () =>
      allTransactions.map(transaction => ({
        type: transaction.type === 'in' ? 'Cash in' : 'Cash out',
        amount: formatMoney(transaction.amount),
        member: transaction.member_name || 'Unknown',
        date: formatDate(transaction.transaction_date || transaction.created_at),
        note: transaction.note || '-',
      })),
    [allTransactions]
  )

  const handleDownloadFilteredExcel = () => {
    const success = downloadFilteredExcel({ exportRows, summary, filterSummaryLabel, exportFileBaseName })
    if (!success) handleError('No filtered transactions available to export.')
  }

  const handleDownloadFilteredPdf = () => {
    const success = downloadFilteredPdf({ exportRows, summary, filterSummaryLabel, filterMemberName, exportFileBaseName })
    if (!success) handleError('No filtered transactions available to export.')
  }

  const submitAuth = async event => {
    event.preventDefault()

    if (!email.trim() || !password) {
      handleError('Email and password are required.')
      return
    }

    if (authMode === 'sign-up' && !orgName.trim()) {
      handleError('Organization name is required for sign up.')
      return
    }

    setAuthSubmitting(true)

    if (authMode === 'sign-up') {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            org_name: orgName.trim(),
          },
        },
      })

      setAuthSubmitting(false)

      if (signUpError) {
        handleError(signUpError.message)
        return
      }

      handleError('Account created. If email confirmation is enabled, verify your email before signing in.')
      setAuthMode('sign-in')
      setPassword('')
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setAuthSubmitting(false)

    if (signInError) {
      handleError(signInError.message)
      return
    }

    setPassword('')
  }

  const signOut = async () => {
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      handleError('Unable to sign out right now.')
    }
  }

  const signInWithGoogle = async () => {
    const redirectTo = typeof window === 'undefined' ? undefined : window.location.origin

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    })

    if (oauthError) {
      handleError(oauthError.message || 'Unable to continue with Google sign-in.')
    }
  }

  const addMember = async () => {
    if (!session?.user?.id) return

    if (!newMember.trim()) {
      handleError('Member name cannot be empty.')
      return
    }

    const { error: insertError } = await supabase.from('members').insert([
      {
        owner_id: session.user.id,
        name: newMember.trim(),
      },
    ])

    if (insertError) {
      handleError(insertError.message || 'Unable to add member.')
      return
    }

    setNewMember('')
    await loadMembers(session.user.id)
  }

  const deleteMember = async memberName => {
    if (!session?.user?.id) return

    const { data: linkedTransactions, error: queryError } = await supabase
      .from('transactions')
      .select('id')
      .eq('owner_id', session.user.id)
      .eq('member_name', memberName)
      .limit(1)

    if (queryError) {
      handleError('Unable to validate member usage.')
      return
    }

    if (linkedTransactions?.length) {
      handleError(`Cannot delete "${memberName}" because the member has transaction history.`)
      return
    }

    openConfirmDialog({
      title: `Delete ${memberName}?`,
      message: 'This member will be removed from your organization.',
      confirmLabel: 'Delete member',
      tone: 'danger',
      onConfirm: async () => {
        const { error: deleteError } = await supabase
          .from('members')
          .delete()
          .eq('owner_id', session.user.id)
          .eq('name', memberName)

        if (deleteError) {
          handleError(deleteError.message || 'Unable to delete member.')
          return
        }

        await loadMembers(session.user.id)
      },
    })
  }

  const addTransaction = async transactionType => {
    if (!session?.user?.id) return

    if (!selectedMemberName) {
      handleError('Please select a member for this transaction.')
      return
    }

    const value = Number(amount)
    if (!value || value <= 0) {
      handleError('Enter a valid amount.')
      return
    }

    const { error: insertError } = await supabase.from('transactions').insert([
      {
        owner_id: session.user.id,
        amount: value,
        type: transactionType,
        note: note.trim(),
        transaction_date: toUTCString(transactionDate),
        member_name: selectedMemberName,
      },
    ])

    if (insertError) {
      handleError(insertError.message || 'Unable to save transaction.')
      return
    }

    setAmount('')
    setNote('')
    setTransactionDate('')
    await loadTransactions(session.user.id, false)
  }

  const toggleTransactionSelection = transactionId => {
    setSelectedTransactionIds(currentIds =>
      currentIds.includes(transactionId)
        ? currentIds.filter(currentId => currentId !== transactionId)
        : [...currentIds, transactionId]
    )
  }

  const toggleVisibleTransactionSelection = () => {
    setSelectedTransactionIds(currentIds => {
      if (allVisibleTransactionsSelected) {
        return currentIds.filter(transactionId => !visibleTransactionIds.includes(transactionId))
      }

      return Array.from(new Set([...currentIds, ...visibleTransactionIds]))
    })
  }

  const deleteTransactionsByIds = async transactionIds => {
    if (!session?.user?.id) return
    if (transactionIds.length === 0) return

    const uniqueTransactionIds = Array.from(new Set(transactionIds))

    const deleteScheduledFor = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const { error: deleteError } = await supabase
      .from('transactions')
      .update({
        deleted_at: new Date().toISOString(),
        delete_scheduled_for: deleteScheduledFor,
      })
      .eq('owner_id', session.user.id)
      .in('id', uniqueTransactionIds)

    if (deleteError) {
      handleError(deleteError.message || 'Unable to move transaction to deleted history.')
      return
    }

    setSelectedTransactionIds(currentIds => currentIds.filter(transactionId => !uniqueTransactionIds.includes(transactionId)))
    await Promise.all([loadTransactions(session.user.id, false), loadDeletedTransactions(session.user.id, false)])
  }

  const deleteTransaction = async transactionId => {
    openConfirmDialog({
      title: 'Delete transaction?',
      message: 'This transaction will move to deleted history. You can restore it for 30 days before automatic removal.',
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => deleteTransactionsByIds([transactionId]),
    })
  }

  const deleteSelectedTransactions = () => {
    if (selectedVisibleTransactionIds.length === 0) {
      handleError('Select at least one transaction to delete.')
      return
    }

    openConfirmDialog({
      title: `Delete ${selectedVisibleTransactionIds.length} selected transaction${selectedVisibleTransactionIds.length === 1 ? '' : 's'}?`,
      message: 'Selected transactions will move to deleted history and remain restorable for 30 days.',
      confirmLabel: 'Delete selected',
      tone: 'danger',
      onConfirm: async () => deleteTransactionsByIds(selectedVisibleTransactionIds),
    })
  }

  const restoreTransaction = async transactionId => {
    if (!session?.user?.id) return
    openConfirmDialog({
      title: 'Restore transaction?',
      message: 'This transaction will return to the main ledger and the restore action will be logged.',
      confirmLabel: 'Restore',
      tone: 'success',
      onConfirm: async () => restoreTransactionsByIds([transactionId]),
    })
  }

  const restoreTransactionsByIds = async transactionIds => {
    if (!session?.user?.id) return
    if (transactionIds.length === 0) return

    const uniqueTransactionIds = Array.from(new Set(transactionIds))
    const transactionsToRestore = deletedTransactions.filter(transaction => uniqueTransactionIds.includes(transaction.id))

    if (transactionsToRestore.length === 0) {
      handleError('No matching deleted transactions were found.')
      return
    }

    const restoredAt = new Date().toISOString()
    const restorePayloads = transactionsToRestore.map(transaction => ({
      transaction_id: transaction.id,
      owner_id: session.user.id,
      restored_by_email: session.user.email || '',
      deleted_at: transaction.deleted_at,
      original_transaction_date: transaction.transaction_date,
      note: transaction.note || '',
      member_name: transaction.member_name || '',
      amount: transaction.amount,
      type: transaction.type,
    }))

    const { error: logError } = await supabase.from('transaction_restore_events').insert(restorePayloads)
    if (logError) {
      handleError(logError.message || 'Unable to log restore activity.')
      return
    }

    const { error: restoreError } = await supabase
      .from('transactions')
      .update({
        deleted_at: null,
        delete_scheduled_for: null,
        last_restored_at: restoredAt,
        last_restored_by_email: session.user.email || '',
      })
      .eq('owner_id', session.user.id)
      .in('id', transactionsToRestore.map(transaction => transaction.id))

    if (restoreError) {
      handleError(restoreError.message || 'Unable to restore transactions.')
      return
    }

    setSelectedDeletedTransactionIds(currentIds =>
      currentIds.filter(transactionId => !transactionsToRestore.some(transaction => transaction.id === transactionId))
    )
    await Promise.all([loadTransactions(session.user.id, false), loadDeletedTransactions(session.user.id, false), loadRestoreEvents(session.user.id)])
  }

  const toggleDeletedTransactionSelection = transactionId => {
    setSelectedDeletedTransactionIds(currentIds =>
      currentIds.includes(transactionId)
        ? currentIds.filter(currentId => currentId !== transactionId)
        : [...currentIds, transactionId]
    )
  }

  const toggleAllDeletedTransactionSelection = () => {
    setSelectedDeletedTransactionIds(currentIds => {
      if (allVisibleDeletedTransactionsSelected) {
        return currentIds.filter(transactionId => !visibleDeletedTransactionIds.includes(transactionId))
      }
      return Array.from(new Set([...currentIds, ...visibleDeletedTransactionIds]))
    })
  }

  const restoreSelectedTransactions = () => {
    if (selectedVisibleDeletedTransactionIds.length === 0) {
      handleError('Select at least one deleted transaction to restore.')
      return
    }

    openConfirmDialog({
      title: `Restore ${selectedVisibleDeletedTransactionIds.length} selected transaction${selectedVisibleDeletedTransactionIds.length === 1 ? '' : 's'}?`,
      message: 'Selected transactions will return to the main ledger and each restore action will be logged.',
      confirmLabel: 'Restore selected',
      tone: 'success',
      onConfirm: async () => restoreTransactionsByIds(selectedVisibleDeletedTransactionIds),
    })
  }

  const restoreAllDeletedTransactions = () => {
    if (visibleDeletedTransactionIds.length === 0) {
      handleError('No deleted transactions available to restore.')
      return
    }

    openConfirmDialog({
      title: `Restore all ${visibleDeletedTransactionIds.length} deleted transaction${visibleDeletedTransactionIds.length === 1 ? '' : 's'}?`,
      message: 'All deleted transactions will return to the main ledger and restore activity will be logged.',
      confirmLabel: 'Restore all',
      tone: 'success',
      onConfirm: async () => restoreTransactionsByIds(visibleDeletedTransactionIds),
    })
  }

  const updateTransaction = async () => {
    if (!session?.user?.id || !editingTransaction) return

    const value = Number(editingTransaction.amount)
    if (!value || value <= 0) {
      handleError('Enter a valid amount.')
      return
    }

    if (!editingTransaction.member_name) {
      handleError('Select a member before saving this transaction.')
      return
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({
        amount: value,
        type: editingTransaction.type,
        note: editingTransaction.note.trim(),
        transaction_date: toUTCString(editingTransaction.transaction_date),
        member_name: editingTransaction.member_name,
      })
      .eq('owner_id', session.user.id)
      .eq('id', editingTransaction.id)

    if (updateError) {
      handleError(updateError.message || 'Unable to update transaction.')
      return
    }

    setEditingTransaction(null)
    await loadTransactions(session.user.id, false)
  }

  const currentUser = session?.user
  const handleThemeChange = nextTheme => {
    if (isValidTheme(nextTheme)) setTheme(nextTheme)
  }

  const hasMoreTransactions = allTransactions.length < totalTransactionsCount;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <main className="main-shell">
        <div className="container">
          <div className="card">
            <h2>Supabase configuration required</h2>
            <p className="alert">
              Add your Supabase project URL and anon key to <code>frontend/.env.local</code> before launching the app.
            </p>
          </div>
        </div>
      </main>
    )
  }

  if (authLoading) {
    return (
      <main className="main-shell">
        <div className="container auth-shell">
          <div className="card auth-card">
            <BrandLogo compact />
            <p className="muted">Checking your session...</p>
          </div>
        </div>
      </main>
    )
  }

  if (!currentUser) {
    return <AuthScreen
      theme={theme}
      onThemeChange={handleThemeChange}
      error={error}
      setError={setError}
      authMode={authMode}
      setAuthMode={setAuthMode}
      submitAuth={submitAuth}
      orgName={orgName}
      setOrgName={setOrgName}
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      authSubmitting={authSubmitting}
      signInWithGoogle={signInWithGoogle}
    />
  }

  return (
    <main className="main-shell">
      <div className="container">
        <header className="brand-row">
          <div className="brand">
            <div className="brand-title-row">
              <BrandLogo compact />
              <ThemeSwitcher theme={theme} onChange={handleThemeChange} />
            </div>
            <p>Manage cash flow for {getOrgLabel(currentUser)}. Members stay scoped to this organization only.</p>
          </div>
          <div className="header-actions header-actions-stack">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div className="user-chip" onClick={() => setShowProfileModal(true)} style={{ cursor: 'pointer' }}>
                <div className="user-chip-avatar-wrapper">
                  {orgLogoUrl ? (
                    <img src={orgLogoUrl} alt="Organization logo" className="user-chip-logo" />
                  ) : (
                    <div className="user-chip-avatar">
                      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3Zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22Z"
                        />
                      </svg>
                    </div>
                  )}
                  <div className="user-chip-edit-overlay">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="user-chip-info">
                  <strong>{getOrgLabel(currentUser)}</strong>
                  <span>{currentUser.email}</span>
                </div>
              </div>
              <button
                className="secondary"
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                style={{ padding: '10px', minWidth: '40px', width: '40px', justifyContent: 'center' }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
            <div className="header-button-row">
              <button className="secondary" onClick={() => setShowMembersModal(true)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>Manage members</span>
                </span>
              </button>
              <button className="secondary" onClick={() => setShowDeletedHistoryModal(true)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <polyline points="3 3 3 8 8 8" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span>Deleted history {totalDeletedCount > 0 ? `(${totalDeletedCount})` : ''}</span>
                </span>
              </button>
            </div>
          </div>
        </header>

        <div className="stats-grid">
          <div className="card">
            <h2>Opening balance</h2>
            <strong>{formatMoney(summary.openingBalance)}</strong>
            <span className="badge">
              {activeRange.startDate ? `Before ${formatFilterDate(activeRange.startDate)}` : 'All time'}
            </span>
          </div>

          <div className="card">
            <h2>Cash balance</h2>
            <strong>{formatMoney(summary.currentBalance)}</strong>
            <span className="badge">
              {summary.transactionCount} total records
            </span>
          </div>

          <div className="card">
            <h2>Cash in</h2>
            <strong>{formatMoney(summary.totalIn)}</strong>
            <span className="badge">incoming money</span>
          </div>

          <div className="card">
            <h2>Cash out</h2>
            <strong>{formatMoney(summary.totalOut)}</strong>
            <span className="badge">spent money</span>
          </div>
        </div>

        {error && (
          <div className="error-toast" role="status" aria-live="polite">
            <span className="error-dot">!</span>
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss message">
              x
            </button>
          </div>
        )}

        <div className="main-layout">
          <div className="left-panel">
            <section className="card entry-card">
              <h2>Record cash flow</h2>
              <div className="entry-grid">
                <div className="form-group">
                  <label htmlFor="amount">Amount</label>
                  <input
                    id="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="transaction-date">Date and time</label>
                  <input
                    id="transaction-date"
                    type="datetime-local"
                    value={transactionDate}
                    onChange={event => setTransactionDate(event.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Member</label>
                  {members.length === 0 ? (
                    <p className="muted">Add members from the Manage members panel.</p>
                  ) : (
                    <div className="chip-list">
                      {members.map(member => (
                        <button
                          key={member.name}
                          type="button"
                        className={selectedMemberName === member.name ? 'name-pill active' : 'name-pill'}
                        onClick={() => setSelectedMemberName(selectedMemberName === member.name ? '' : member.name)}
                      >
                        {member.name}
                      </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="note">Note</label>
                  <textarea
                    id="note"
                    rows="2"
                    placeholder="Optional note"
                    value={note}
                    onChange={event => setNote(event.target.value)}
                  />
                  {noteSuggestions.length > 0 && (
                    <div className="note-suggestions" role="listbox" aria-label="Suggested notes">
                      <span className="note-suggestions-label">Use a previous note</span>
                      <div className="note-suggestion-list">
                        {noteSuggestions.map(noteOption => (
                          <button
                            key={noteOption.normalized}
                            type="button"
                            className="note-suggestion-chip"
                            onClick={() => setNote(noteOption.value)}
                          >
                            {noteOption.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Type</label>
                  <div className="button-group">
                    <button className="cash-in" type="button" onClick={() => addTransaction('in')}>
                      Cash In
                    </button>
                    <button className="cash-out" type="button" onClick={() => addTransaction('out')}>
                      Cash Out
                    </button>
                  </div>
                </div>
              </div>

              <div className="entry-filters">
                <div className="entry-filters-header">
                  <div className="entry-filters-title">
                    <span className="entry-filters-kicker">Cashflow filters</span>
                    <div className="entry-filters-meta">
                      <span className="badge subtle">{summary.transactionCount} records found</span>
                      {activeFilterCount > 0 && (
                        <span className="badge accent-badge">{activeFilterCount} active</span>
                      )}
                    </div>
                  </div>
                  <div className="entry-filters-export">
                    <button
                      className="export-icon-button excel-export"
                      type="button"
                      onClick={handleDownloadFilteredExcel}
                      aria-label="Download filtered transactions as Excel"
                      title="Download Excel"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Zm0 0v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="m9 10 6 8M15 10l-6 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      className="export-icon-button pdf-export"
                      type="button"
                      onClick={handleDownloadFilteredPdf}
                      aria-label="Download filtered transactions as PDF"
                      title="Download PDF"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Zm0 0v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M8.5 16.5h1.2c.9 0 1.5-.6 1.5-1.4s-.6-1.4-1.5-1.4H8.5Zm5.1 2v-4.8h1.2c1.3 0 2.2.9 2.2 2.4s-.9 2.4-2.2 2.4Zm-5.1 0v-1.2m0 0v1.2m4.3-4.8H12v4.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="entry-filters-segment" role="tablist" aria-label="Cashflow type">
                  {typeFilterOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={filterTransactionType === option.value}
                      className={filterTransactionType === option.value ? `segment-pill active segment-${option.value}` : 'segment-pill'}
                      onClick={() => setFilterTransactionType(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="entry-filters-presets" role="tablist" aria-label="Date range filters">
                  {datePresetOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={filterDatePreset === option.value ? 'filter-pill active' : 'filter-pill'}
                      onClick={() => setFilterDatePreset(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="entry-filters-advanced">
                    <label className="filter-control" htmlFor="filter-member">
                      <span>Member</span>
                      <select
                        id="filter-member"
                        value={filterMemberName}
                        onChange={event => setFilterMemberName(event.target.value)}
                      >
                        <option value="all">All members</option>
                        {members.map(member => (
                          <option key={member.name} value={member.name}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="filter-control filter-search" htmlFor="filter-note">
                      <span>Remarks</span>
                      <input
                        id="filter-note"
                        type="text"
                        placeholder="Search notes"
                        value={filterNote}
                        onChange={event => setFilterNote(event.target.value)}
                      />
                    </label>

                    {filterDatePreset === 'custom' && (
                      <div className="filter-custom-dates active">
                        <label className="filter-control" htmlFor="filter-start-date">
                          <span>From</span>
                          <input
                            id="filter-start-date"
                            type="date"
                            value={filterStartDate}
                            onChange={event => setFilterStartDate(event.target.value)}
                          />
                        </label>

                        <label className="filter-control" htmlFor="filter-end-date">
                          <span>To</span>
                          <input
                            id="filter-end-date"
                            type="date"
                            value={filterEndDate}
                            onChange={event => setFilterEndDate(event.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                <div className="entry-filters-footer">
                  <span className="entry-filters-summary">{filterSummaryLabel}</span>
                  {activeFilterCount > 0 && (
                    <button className="filter-clear-link" type="button" onClick={clearFilters}>
                      Clear {activeFilterCount}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="right-panel">
            <section className="card transactions-card">
              {loading ? (
                <p className="muted">Loading transactions...</p>
              ) : allTransactions.length === 0 ? (
                <p className="muted">
                  {activeFilterCount > 0
                    ? 'No transactions matched the current filters.'
                    : 'No cash movements yet. Add cash in or cash out to get started.'}
                </p>
              ) : (
                <div className="table-wrapper transaction-table">
                  <div className="bulk-action-bar">
                    <div className="bulk-selection-summary">
                      <label className="selection-control">
                        <input
                          type="checkbox"
                          checked={allVisibleTransactionsSelected}
                          onChange={toggleVisibleTransactionSelection}
                        />
                        <span>Select all</span>
                      </label>
                      <span className="badge">{selectedVisibleTransactionIds.length} selected</span>
                      <span className="badge">{allTransactions.length} loaded</span>
                    </div>
                    <div className="bulk-action-buttons">
                      <button
                        className="danger"
                        type="button"
                        onClick={deleteSelectedTransactions}
                        disabled={selectedVisibleTransactionIds.length === 0}
                      >
                        Delete selected
                      </button>
                    </div>
                  </div>
                  <div className="table-head">
                    <span>Type</span>
                    <span>Amount</span>
                    <span>Note</span>
                    <span>Member</span>
                    <span>Date and time</span>
                    <span>Actions</span>
                  </div>
                  <div className="table-body">
                    {allTransactions.map(transaction => (
                      <div key={transaction.id} className="table-row">
                        <span className="transaction-type-cell">
                          <input
                            type="checkbox"
                            aria-label={`Select ${transaction.type === 'in' ? 'cash in' : 'cash out'} transaction`}
                            checked={selectedTransactionIds.includes(transaction.id)}
                            onChange={() => toggleTransactionSelection(transaction.id)}
                          />
                          <span className={`tag ${transaction.type === 'in' ? 'credit' : 'debit'}`}>
                            {transaction.type === 'in' ? 'Cash in' : 'Cash out'}
                          </span>
                        </span>
                        <span>{formatMoney(transaction.amount)}</span>
                        <span>
                          {transaction.note || '-'}
                          {transaction.last_restored_at && (
                            <small className="table-subtext">
                              {formatRelativeRestoreWindow(transaction.last_restored_at)}
                              {transaction.last_restored_by_email ? ` by ${transaction.last_restored_by_email}` : ''}
                            </small>
                          )}
                        </span>
                        <span>{transaction.member_name || 'Unknown'}</span>
                        <span>{transaction.transaction_date ? formatDate(transaction.transaction_date) : formatDate(transaction.created_at)}</span>
                        <span className="action-cell">
                          <button className="secondary" type="button" onClick={() => setEditingTransaction(transaction)}>
                            Edit
                          </button>
                          <button className="danger" type="button" onClick={() => deleteTransaction(transaction.id)}>
                            Delete
                          </button>
                        </span>
                      </div>
                    ))}
                    {hasMoreTransactions && (
                       <div style={{ padding: '24px 0 12px', textAlign: 'center' }}>
                         <button 
                            className="secondary" 
                            style={{ borderRadius: '99px', padding: '10px 24px' }} 
                            onClick={() => loadTransactions(session.user.id, true)} 
                            disabled={loadingMoreTransactions}
                          >
                           {loadingMoreTransactions 
                             ? 'Loading...' 
                             : `Load older records (${allTransactions.length} of ${totalTransactionsCount} loaded)`}
                         </button>
                       </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {editingTransaction && (
          <div className="modal-overlay">
            <div className="edit-modal card">
              <h2>Edit transaction</h2>

              <div className="form-group">
                <label htmlFor="edit-amount">Amount</label>
                <input
                  id="edit-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={editingTransaction.amount}
                  onChange={event => setEditingTransaction({ ...editingTransaction, amount: event.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-transaction-date">Date and time</label>
                <input
                  id="edit-transaction-date"
                  type="datetime-local"
                  value={toDateTimeLocalValue(editingTransaction.transaction_date)}
                  onChange={event => setEditingTransaction({ ...editingTransaction, transaction_date: event.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Member</label>
                {members.length === 0 ? (
                  <p className="muted">No members available.</p>
                ) : (
                  <div className="chip-list">
                    {members.map(member => (
                      <button
                        key={member.name}
                        type="button"
                        className={editingTransaction.member_name === member.name ? 'name-pill active' : 'name-pill'}
                        onClick={() => setEditingTransaction({ ...editingTransaction, member_name: member.name })}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="edit-note">Note</label>
                <textarea
                  id="edit-note"
                  rows="3"
                  placeholder="Optional note"
                  value={editingTransaction.note || ''}
                  onChange={event => setEditingTransaction({ ...editingTransaction, note: event.target.value })}
                />
                {editNoteSuggestions.length > 0 && (
                  <div className="note-suggestions" role="listbox" aria-label="Suggested notes">
                    <span className="note-suggestions-label">Use a previous note</span>
                    <div className="note-suggestion-list">
                      {editNoteSuggestions.map(noteOption => (
                        <button
                          key={noteOption.normalized}
                          type="button"
                          className="note-suggestion-chip"
                          onClick={() => setEditingTransaction({ ...editingTransaction, note: noteOption.value })}
                        >
                          {noteOption.value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Type</label>
                <div className="button-group">
                  <button
                    className={editingTransaction.type === 'in' ? 'cash-in' : 'secondary'}
                    type="button"
                    onClick={() => setEditingTransaction({ ...editingTransaction, type: 'in' })}
                    style={{ flex: 1 }}
                  >
                    Cash In
                  </button>
                  <button
                    className={editingTransaction.type === 'out' ? 'cash-out' : 'secondary'}
                    type="button"
                    onClick={() => setEditingTransaction({ ...editingTransaction, type: 'out' })}
                    style={{ flex: 1 }}
                  >
                    Cash Out
                  </button>
                </div>
              </div>

              <div className="button-group" style={{ marginTop: '24px' }}>
                <button className="primary" type="button" onClick={updateTransaction}>
                  Update transaction
                </button>
                <button className="secondary" type="button" onClick={() => setEditingTransaction(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showMembersModal && (
          <div className="modal-overlay">
            <div className="edit-modal card names-modal">
              <div className="modal-header">
                <h2>Manage members</h2>
                <button className="secondary" type="button" onClick={() => setShowMembersModal(false)}>
                  Close
                </button>
              </div>

              <div className="form-group">
                <label htmlFor="new-member-modal">Add member</label>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <input
                    id="new-member-modal"
                    type="text"
                    placeholder="Enter member name"
                    value={newMember}
                    onChange={event => setNewMember(event.target.value)}
                    style={{ flex: 1, minWidth: '220px' }}
                  />
                  <button className="primary" type="button" onClick={addMember}>
                    Add member
                  </button>
                </div>
              </div>

              <div className="form-group">
                <h3 style={{ margin: 0, color: 'var(--muted)' }}>Members in this organization</h3>
              </div>
              {members.length === 0 ? (
                <p className="muted">No members yet. Add one to start tracking entries.</p>
              ) : (
                <div className="chip-list" style={{ marginTop: '12px' }}>
                  {members.map(member => (
                    <div key={member.name} className="chip-item">
                      <span className="badge">{member.name}</span>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => deleteMember(member.name)}
                        style={{ fontSize: '10px', padding: '2px 6px', minWidth: 'auto' }}
                        title={`Delete ${member.name}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <ProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          userId={currentUser.id}
          currentLogoUrl={orgLogoUrl ? `${orgLogoUrl}?t=${Date.now()}` : null}
          hasLogo={hasOrgLogo}
          onLogoUpdate={(newUrl) => {
            setOrgLogoUrl(newUrl)
            setHasOrgLogo(!!newUrl)
          }}
        />

        <DeletedHistoryModal
          show={showDeletedHistoryModal}
          onClose={() => setShowDeletedHistoryModal(false)}
          deletedTransactions={deletedTransactions}
          allVisibleDeletedTransactionsSelected={allVisibleDeletedTransactionsSelected}
          toggleAllDeletedTransactionSelection={toggleAllDeletedTransactionSelection}
          selectedVisibleDeletedTransactionIds={selectedVisibleDeletedTransactionIds}
          restoreSelectedTransactions={restoreSelectedTransactions}
          restoreAllDeletedTransactions={restoreAllDeletedTransactions}
          selectedDeletedTransactionIds={selectedDeletedTransactionIds}
          toggleDeletedTransactionSelection={toggleDeletedTransactionSelection}
          restoreTransaction={restoreTransaction}
          restoreEvents={restoreEvents}
        />

        {confirmDialog && (
          <div className="modal-overlay confirm-overlay" role="presentation">
            <div className={`card confirm-modal ${confirmDialog.tone === 'danger' ? 'danger-confirm' : confirmDialog.tone === 'success' ? 'success-confirm' : ''}`} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
              <div className="confirm-icon" aria-hidden="true">
                {confirmDialog.tone === 'danger' ? '!' : confirmDialog.tone === 'success' ? 'OK' : '?'}
              </div>
              <div className="confirm-copy">
                <h2 id="confirm-title">{confirmDialog.title}</h2>
                <p>{confirmDialog.message}</p>
              </div>
              <div className="confirm-actions">
                <button className="secondary" type="button" onClick={closeConfirmDialog} disabled={confirmSubmitting}>
                  {confirmDialog.cancelLabel}
                </button>
                <button
                  className={confirmDialog.tone === 'danger' ? 'danger' : 'primary'}
                  type="button"
                  onClick={runConfirmedAction}
                  disabled={confirmSubmitting}
                >
                  {confirmSubmitting ? 'Please wait...' : confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}