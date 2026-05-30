import { supabase } from '../../../lib/supabaseClient'

export const fetchTransactions = async (
  userId, 
  fromOffset = 0, 
  toOffset = 199, // 199 gives exactly 200 rows (0-indexed)
  filters = {} 
) => {
  let query = supabase
    .from('transactions')
    .select('id,amount,type,note,transaction_date,created_at,member_name,deleted_at,delete_scheduled_for,last_restored_at,last_restored_by_email', { count: 'exact' })
    .eq('owner_id', userId)
    .is('deleted_at', null)

  // 1. Server-side Type filter
  if (filters.type && filters.type !== 'all') {
    query = query.eq('type', filters.type)
  }

  // 2. Server-side Member filter
  if (filters.memberName && filters.memberName !== 'all') {
    query = query.eq('member_name', filters.memberName)
  }

  // 3. Server-side Note Search (ilike is case-insensitive search)
  if (filters.noteSearch) {
    query = query.ilike('note', `%${filters.noteSearch}%`)
  }

  // 4. Server-side Date filtering
  if (filters.startDate) {
    query = query.gte('transaction_date', filters.startDate.toISOString())
  }
  if (filters.endDate) {
    query = query.lte('transaction_date', filters.endDate.toISOString())
  }

  // Finally, order by newest first and grab the paginated range
  return query
    .order('transaction_date', { ascending: false })
    .range(fromOffset, toOffset)
}

export const fetchDeletedTransactions = async (
  userId, 
  fromOffset = 0, 
  toOffset = 199
) =>
  supabase
    .from('transactions')
    .select('id,amount,type,note,transaction_date,created_at,member_name,deleted_at,delete_scheduled_for,last_restored_at,last_restored_by_email', { count: 'exact' })
    .eq('owner_id', userId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .range(fromOffset, toOffset)

export const fetchRestoreEvents = async userId =>
  supabase
    .from('transaction_restore_events')
    .select('id,transaction_id,restored_at,restored_by_email,deleted_at,original_transaction_date,note,member_name,amount,type')
    .eq('owner_id', userId)
    .order('restored_at', { ascending: false })
    .limit(12)

export const fetchMembers = async userId => 
  supabase
    .from('members')
    .select('name')
    .eq('owner_id', userId)
    .order('name')

export const fetchLedgerSummary = async (userId, filters = {}) => {
  const { data, error } = await supabase.rpc('get_ledger_summary', {
    p_owner_id: userId,
    p_type: filters.type === 'all' ? null : filters.type,
    p_member: filters.memberName === 'all' ? null : filters.memberName,
    p_note: filters.noteSearch || null,
    p_start_date: filters.startDate ? filters.startDate.toISOString() : null,
    p_end_date: filters.endDate ? filters.endDate.toISOString() : null
  });
  
  if (error) throw error;
  return data;
}