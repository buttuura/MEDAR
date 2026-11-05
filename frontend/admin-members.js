const adminMessage = document.getElementById('adminMessage');
const membersTableBody = document.getElementById('membersTableBody');
const membersEmpty = document.getElementById('membersEmpty');
const memberCount = document.getElementById('memberCount');
const adminAccessSection = document.getElementById('adminAccessSection');
const adminList = document.getElementById('adminList');
const adminAccessForm = document.getElementById('adminAccessForm');
const grantAdminButton = document.getElementById('grantAdminButton');
const memberSearch = document.getElementById('memberSearch');
const memberPageStatus = document.getElementById('memberPageStatus');
const previousMembersPage = document.getElementById('previousMembersPage');
const nextMembersPage = document.getElementById('nextMembersPage');
const membersPerPage = 20;
let allMembers = [];
let currentMembersPage = 1;
const membershipTypeLabels = {
  beneficiary: 'Beneficiary',
  partner: 'Partner',
  founding: 'Founding'
};

function showAdminMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle('auth-error', isError);
  adminMessage.hidden = false;
}

async function readResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      result.detail || result.error || result.message || 'Unable to complete this request.'
    );
  }
  return result;
}

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf');
  return (await readResponse(response)).token;
}

function createCell(text, className = '', label = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  if (label) cell.dataset.label = label;
  cell.textContent = text || '—';
  return cell;
}

function createMemberRow(member) {
  const row = document.createElement('tr');
  const memberCell = document.createElement('td');
  const memberName = document.createElement('strong');
  const memberEmail = document.createElement('span');
  memberName.textContent = member.fullName || 'Unnamed member';
  memberEmail.className = 'member-email';
  memberEmail.textContent = member.email || 'No email';
  memberCell.className = 'member-summary';
  const memberDetails = document.createElement('div');
  memberDetails.append(memberName, memberEmail);
  const detailsButton = document.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'member-details-toggle';
  detailsButton.textContent = 'Show details';
  detailsButton.setAttribute('aria-expanded', 'false');
  memberCell.append(memberDetails, detailsButton);
  row.append(memberCell);
  const memberIdCell = createCell(member.memberId, 'mobile-member-detail', 'Member ID');
  memberIdCell.dataset.memberDetail = '';
  row.append(memberIdCell);

  const locationCell = document.createElement('td');
  locationCell.className = 'mobile-member-detail';
  locationCell.dataset.memberDetail = '';
  locationCell.dataset.label = 'Country / status';
  const country = document.createElement('strong');
  const status = document.createElement('span');
  country.textContent = member.country || '—';
  status.className = 'member-email';
  status.textContent = member.memberStatus || '—';
  locationCell.append(country, status);
  row.append(locationCell);

  const typeCell = document.createElement('td');
  const typeSelect = document.createElement('select');
  typeSelect.className = 'member-type-select';
  typeSelect.setAttribute('aria-label', `Membership type for ${member.fullName || 'member'}`);
  Object.entries(membershipTypeLabels).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    typeSelect.append(option);
  });
  typeSelect.value = membershipTypeLabels[member.membershipType]
    ? member.membershipType
    : 'member';
  typeCell.className = 'mobile-member-detail';
  typeCell.dataset.memberDetail = '';
  typeCell.dataset.label = 'Joined as';
  typeCell.append(typeSelect);
  row.append(typeCell);

  const joined = member.submittedAt ? new Date(member.submittedAt) : null;
  const joinedCell = createCell(joined && !Number.isNaN(joined.getTime())
    ? joined.toLocaleDateString()
    : '—', 'mobile-member-detail', 'Joined on');
  joinedCell.dataset.memberDetail = '';
  row.append(joinedCell);

  const documentsCell = document.createElement('td');
  documentsCell.className = 'member-document-cell mobile-member-detail';
  documentsCell.dataset.memberDetail = '';
  documentsCell.dataset.label = 'Documents';
  const documents = Array.isArray(member.documents) ? member.documents : [];
  if (documents.length) {
    for (const document of documents) {
      const link = document.createElement('a');
      const categoryLabels = {
        identity: 'Passport / National ID',
        supporting: 'Supporting document',
        passportPhoto: 'Passport photo'
      };
      const category = categoryLabels[document.category] || 'Member document';
      link.href = `/api/admin/members/${encodeURIComponent(member.memberId)}/documents/${encodeURIComponent(document.index)}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = `${category}: ${document.filename || 'View file'}`;
      documentsCell.append(link);
    }
  } else {
    documentsCell.textContent = 'No uploaded documents';
  }
  row.append(documentsCell);

  const actionsCell = document.createElement('td');
  actionsCell.className = 'member-actions mobile-member-detail';
  actionsCell.dataset.memberDetail = '';
  actionsCell.dataset.label = 'Actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'member-save';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(
        `/api/admin/members/${encodeURIComponent(member.memberId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-XSRF-TOKEN': csrfToken
          },
          body: JSON.stringify({ membershipType: typeSelect.value })
        }
      );
      await readResponse(response);
      showAdminMessage(`${member.fullName || 'Member'}'s membership type was updated.`);
    } catch (error) {
      showAdminMessage(error.message || 'Unable to update this membership type.', true);
    } finally {
      saveButton.disabled = false;
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'member-delete';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Delete the membership application for ${member.fullName || 'this member'}?`)) {
      return;
    }
    deleteButton.disabled = true;
    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch(
        `/api/admin/members/${encodeURIComponent(member.memberId)}`,
        {
          method: 'DELETE',
          headers: { 'X-XSRF-TOKEN': csrfToken }
        }
      );
      await readResponse(response);
      showAdminMessage(`${member.fullName || 'Member'}'s membership application was deleted.`);
      await loadMembers();
    } catch (error) {
      showAdminMessage(error.message || 'Unable to delete this membership application.', true);
    } finally {
      deleteButton.disabled = false;
    }
  });
  actionsCell.append(saveButton, deleteButton);
  row.append(actionsCell);

  detailsButton.addEventListener('click', () => {
    const expanded = detailsButton.getAttribute('aria-expanded') === 'true';
    detailsButton.setAttribute('aria-expanded', String(!expanded));
    detailsButton.textContent = expanded ? 'Show details' : 'Hide details';
    row.querySelectorAll('[data-member-detail]').forEach(cell => {
      cell.hidden = expanded;
    });
  });
  setMemberRowCompact(row);
  return row;
}

function setMemberRowCompact(row) {
  const compact = window.matchMedia('(max-width: 700px)').matches;
  row.querySelectorAll('[data-member-detail]').forEach(cell => {
    cell.hidden = compact &&
      row.querySelector('.member-details-toggle').getAttribute('aria-expanded') !== 'true';
  });
}

function renderMembers() {
  const searchTerm = memberSearch.value.trim().toLocaleLowerCase();
  const filteredMembers = allMembers.filter(member => [
    member.fullName,
    member.email,
    member.memberId,
    member.country,
    member.memberStatus,
    membershipTypeLabels[member.membershipType]
  ].some(value => String(value || '').toLocaleLowerCase().includes(searchTerm)));
  const pageCount = Math.ceil(filteredMembers.length / membersPerPage);
  currentMembersPage = Math.min(currentMembersPage, Math.max(pageCount, 1));
  const firstMember = (currentMembersPage - 1) * membersPerPage;
  const visibleMembers = filteredMembers.slice(firstMember, firstMember + membersPerPage);
  membersTableBody.replaceChildren(...visibleMembers.map(createMemberRow));
  memberPageStatus.textContent = filteredMembers.length
    ? `Showing ${firstMember + 1}–${firstMember + visibleMembers.length} of ${filteredMembers.length}`
    : 'No matching members';
  previousMembersPage.disabled = currentMembersPage <= 1;
  nextMembersPage.disabled = currentMembersPage >= pageCount;
  membersEmpty.textContent = searchTerm && filteredMembers.length === 0
    ? 'No members match your search.'
    : 'No membership applications have been submitted yet.';
  membersEmpty.hidden = filteredMembers.length > 0;
}

async function loadMembers() {
  membersTableBody.replaceChildren();
  membersEmpty.hidden = true;
  memberCount.textContent = 'Loading members…';
  const response = await fetch('/api/admin/members');
  const result = await readResponse(response);
  allMembers = result.members;
  currentMembersPage = 1;
  memberCount.textContent = `${allMembers.length} ${allMembers.length === 1 ? 'member' : 'members'}`;
  renderMembers();
}

function createAdminEntry(admin) {
  const entry = document.createElement('li');
  const identity = document.createElement('div');
  const name = document.createElement('strong');
  const email = document.createElement('span');
  const role = document.createElement('span');
  name.textContent = admin.fullName || admin.email;
  email.className = 'member-email';
  email.textContent = admin.email;
  role.className = 'admin-role';
  role.textContent = admin.role === 'super' ? 'Super admin' : 'Admin';
  identity.append(name, email);
  entry.append(identity, role);

  if (admin.role === 'admin') {
    const revokeButton = document.createElement('button');
    revokeButton.type = 'button';
    revokeButton.className = 'member-delete';
    revokeButton.textContent = 'Remove access';
    revokeButton.addEventListener('click', async () => {
      if (!window.confirm(`Remove administrator access from ${admin.email}?`)) return;
      revokeButton.disabled = true;
      try {
        const csrfToken = await getCsrfToken();
        const response = await fetch(
          `/api/admin/admins/${encodeURIComponent(admin.email)}`,
          { method: 'DELETE', headers: { 'X-XSRF-TOKEN': csrfToken } }
        );
        await readResponse(response);
        showAdminMessage(`Administrator access was removed from ${admin.email}.`);
        await loadAdmins();
      } catch (error) {
        showAdminMessage(error.message || 'Unable to remove administrator access.', true);
      } finally {
        revokeButton.disabled = false;
      }
    });
    entry.append(revokeButton);
  }
  return entry;
}

async function loadAdmins() {
  adminList.replaceChildren();
  const response = await fetch('/api/admin/admins');
  const result = await readResponse(response);
  result.admins.forEach(admin => adminList.append(createAdminEntry(admin)));
}

async function initializeAdminPage() {
  const accountResponse = await fetch('/api/auth/me');
  if (accountResponse.status === 401) {
    window.location.replace('/login.html?next=%2Fadmin-members.html');
    return;
  }
  const account = await readResponse(accountResponse);
  if (!account.isAdmin) {
    window.location.replace('/index.html');
    return;
  }
  if (account.isSuperAdmin) {
    adminAccessSection.hidden = false;
    await loadAdmins();
  }
  await loadMembers();
}

adminAccessForm.addEventListener('submit', async event => {
  event.preventDefault();
  grantAdminButton.disabled = true;
  adminMessage.hidden = true;
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': csrfToken
      },
      body: JSON.stringify({ email: document.getElementById('adminEmail').value.trim() })
    });
    await readResponse(response);
    adminAccessForm.reset();
    showAdminMessage('Administrator access granted.');
    await loadAdmins();
  } catch (error) {
    showAdminMessage(error.message || 'Unable to grant administrator access.', true);
  } finally {
    grantAdminButton.disabled = false;
  }
});

document.getElementById('refreshMembers').addEventListener('click', () => {
  adminMessage.hidden = true;
  loadMembers().catch(error => {
    memberCount.textContent = 'Unable to load members';
    showAdminMessage(error.message || 'Unable to load membership applications.', true);
  });
});

memberSearch.addEventListener('input', () => {
  currentMembersPage = 1;
  renderMembers();
});

previousMembersPage.addEventListener('click', () => {
  if (currentMembersPage > 1) {
    currentMembersPage -= 1;
    renderMembers();
  }
});

nextMembersPage.addEventListener('click', () => {
  currentMembersPage += 1;
  renderMembers();
});

window.matchMedia('(max-width: 700px)').addEventListener('change', () => {
  membersTableBody.querySelectorAll('tr').forEach(setMemberRowCompact);
});

initializeAdminPage().catch(error => {
  memberCount.textContent = 'Unable to load members';
  showAdminMessage(error.message || 'Unable to load the member management page.', true);
});
