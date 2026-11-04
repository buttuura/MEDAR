const adminMessage = document.getElementById('adminMessage');
const membersTableBody = document.getElementById('membersTableBody');
const membersEmpty = document.getElementById('membersEmpty');
const memberCount = document.getElementById('memberCount');
const membershipTypeLabels = {
  member: 'Member',
  donor: 'Donor',
  investor: 'Investor'
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

function createCell(text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
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
  memberCell.append(memberName, memberEmail);
  row.append(memberCell);
  row.append(createCell(member.memberId));

  const locationCell = document.createElement('td');
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
  typeCell.append(typeSelect);
  row.append(typeCell);

  const joined = member.submittedAt ? new Date(member.submittedAt) : null;
  row.append(createCell(joined && !Number.isNaN(joined.getTime())
    ? joined.toLocaleDateString()
    : '—'));

  const actionsCell = document.createElement('td');
  actionsCell.className = 'member-actions';
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
  return row;
}

async function loadMembers() {
  membersTableBody.replaceChildren();
  membersEmpty.hidden = true;
  memberCount.textContent = 'Loading members…';
  const response = await fetch('/api/admin/members');
  const result = await readResponse(response);
  const members = result.members;
  members.forEach(member => membersTableBody.append(createMemberRow(member)));
  memberCount.textContent = `${members.length} ${members.length === 1 ? 'member' : 'members'}`;
  membersEmpty.hidden = members.length > 0;
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
  await loadMembers();
}

document.getElementById('refreshMembers').addEventListener('click', () => {
  adminMessage.hidden = true;
  loadMembers().catch(error => {
    memberCount.textContent = 'Unable to load members';
    showAdminMessage(error.message || 'Unable to load membership applications.', true);
  });
});

initializeAdminPage().catch(error => {
  memberCount.textContent = 'Unable to load members';
  showAdminMessage(error.message || 'Unable to load the member management page.', true);
});
