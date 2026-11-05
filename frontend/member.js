const registrationForm = document.getElementById('fullRegisterForm');
const registrationMessage = document.getElementById('memberFormMessage');
const submitButton = registrationForm.querySelector('button[type="submit"]');
const passportPhotoInput = document.getElementById('passportPhoto');
const passportPhotoStatus = document.getElementById('passportPhotoStatus');
const passportPhotoPreview = document.getElementById('pPhoto');
const uploadPassportPhotoButton = document.getElementById('uploadPassportPhotoButton');
const passportPhotoUploadMessage = document.getElementById('passportPhotoUploadMessage');
const downloadMemberIdButton = document.getElementById('downloadMemberIdButton');
let passportPhotoPreviewUrl = '';

document.getElementById('fullName').addEventListener('input', event => {
  document.getElementById('pName').textContent = event.target.value.trim() || 'Your name';
});
document.getElementById('country').addEventListener('change', event => {
  document.getElementById('pCountry').textContent = event.target.value || '-';
});
document.getElementById('membershipType').addEventListener('change', event => {
  const membershipTypes = { member: 'Member', donor: 'Donor', investor: 'Investor' };
  document.getElementById('pStatus').textContent = membershipTypes[event.target.value] || '-';
});

const identityDocumentInput = document.getElementById('identityDocument');
const supportingDocumentsInput = document.getElementById('supportingDocuments');
const maxDocumentSize = 10 * 1024 * 1024;
const maxPassportPhotoSize = 5 * 1024 * 1024;
const allowedSupportingTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const allowedSupportingExtensions = /\.(pdf|jpe?g|png)$/i;

function validatePassportPhoto() {
  const file = passportPhotoInput.files[0];
  let error = '';

  if (!file) {
    passportPhotoStatus.textContent = 'No photo selected';
    if (passportPhotoPreviewUrl) {
      URL.revokeObjectURL(passportPhotoPreviewUrl);
      passportPhotoPreviewUrl = '';
    }
    passportPhotoPreview.hidden = true;
    passportPhotoPreview.removeAttribute('src');
    passportPhotoPreview.nextElementSibling.hidden = false;
  } else if (!/\.(jpe?g|png)$/i.test(file.name) ||
      (file.type && !['image/jpeg', 'image/png'].includes(file.type))) {
    error = 'The passport photo must be a JPG or PNG image.';
    passportPhotoStatus.textContent = 'Invalid file type';
  } else if (file.size > maxPassportPhotoSize) {
    error = 'The passport photo must be 5 MB or smaller.';
    passportPhotoStatus.textContent = 'File is larger than 5 MB';
  } else {
    passportPhotoStatus.textContent = file.name;
    if (passportPhotoPreviewUrl) {
      URL.revokeObjectURL(passportPhotoPreviewUrl);
    }
    passportPhotoPreviewUrl = URL.createObjectURL(file);
    passportPhotoPreview.src = passportPhotoPreviewUrl;
    passportPhotoPreview.hidden = false;
    passportPhotoPreview.nextElementSibling.hidden = true;
  }

  if (error) {
    if (passportPhotoPreviewUrl) {
      URL.revokeObjectURL(passportPhotoPreviewUrl);
      passportPhotoPreviewUrl = '';
    }
    passportPhotoPreview.hidden = true;
    passportPhotoPreview.removeAttribute('src');
    passportPhotoPreview.nextElementSibling.hidden = false;
  }
  passportPhotoInput.setCustomValidity(error);
}

function validateIdentityDocument() {
  const file = identityDocumentInput.files[0];
  const status = document.getElementById('identityDocumentStatus');
  let error = '';

  if (!file) {
    status.textContent = 'No file selected';
  } else if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
    error = 'The identity document must be a PDF.';
    status.textContent = 'Invalid file type';
  } else if (file.size > maxDocumentSize) {
    error = 'The identity PDF must be 10 MB or smaller.';
    status.textContent = 'File is larger than 10 MB';
  } else {
    status.textContent = file.name;
  }

  identityDocumentInput.setCustomValidity(error);
}

function validateSupportingDocuments() {
  const files = Array.from(supportingDocumentsInput.files);
  const status = document.getElementById('supportingDocumentsStatus');
  let error = '';

  if (files.length > 5) {
    error = 'Choose no more than 5 supporting documents.';
  } else if (files.some(file => (
    (file.type && !allowedSupportingTypes.has(file.type)) ||
    !allowedSupportingExtensions.test(file.name)
  ))) {
    error = 'Supporting documents must be PDF, JPG, or PNG files.';
  } else if (files.some(file => file.size > maxDocumentSize)) {
    error = 'Each supporting document must be 10 MB or smaller.';
  }

  supportingDocumentsInput.setCustomValidity(error);
  status.textContent = error || (files.length
    ? files.map(file => file.name).join(', ')
    : 'No files selected');
}

identityDocumentInput.addEventListener('change', validateIdentityDocument);
supportingDocumentsInput.addEventListener('change', validateSupportingDocuments);
passportPhotoInput.addEventListener('change', validatePassportPhoto);
uploadPassportPhotoButton.addEventListener('click', async () => {
  validatePassportPhoto();
  if (!passportPhotoInput.reportValidity()) {
    return;
  }

  uploadPassportPhotoButton.disabled = true;
  passportPhotoUploadMessage.textContent = 'Uploading your photo…';
  passportPhotoUploadMessage.classList.remove('is-error', 'is-success');
  passportPhotoUploadMessage.hidden = false;
  const formData = new FormData();
  formData.append('passportPhoto', passportPhotoInput.files[0]);

  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/members/photo', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': csrfToken },
      body: formData
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || result.error || result.message || 'Unable to upload your passport photo. Please try again.');
    }

    uploadPassportPhotoButton.hidden = true;
    passportPhotoInput.disabled = true;
    downloadMemberIdButton.hidden = false;
    passportPhotoUploadMessage.textContent = 'Photo uploaded successfully. Your Member ID PDF is ready to download.';
    passportPhotoUploadMessage.classList.add('is-success');
  } catch (error) {
    passportPhotoUploadMessage.textContent = error.message || 'Unable to upload your passport photo. Please try again.';
    passportPhotoUploadMessage.classList.add('is-error');
    uploadPassportPhotoButton.disabled = false;
  }
});
validateIdentityDocument();
validateSupportingDocuments();
validatePassportPhoto();

async function getCsrfToken() {
  const response = await fetch('/api/auth/csrf');
  if (!response.ok) {
    throw new Error('Unable to start a secure session. Please try again.');
  }
  return (await response.json()).token;
}

function showRegistrationMessage(message, isError = false) {
  registrationMessage.textContent = message;
  registrationMessage.classList.toggle('auth-error', isError);
  registrationMessage.classList.toggle('member-success', !isError);
  registrationMessage.hidden = false;
}

async function initializeMembershipForm() {
  const accountResponse = await fetch('/api/auth/me');
  if (accountResponse.status === 401) {
    window.location.replace('/login.html?next=%2Fbecome-member.html');
    return;
  }
  if (!accountResponse.ok) {
    throw new Error('Unable to verify your account. Please refresh and try again.');
  }

  const account = await accountResponse.json();
  document.getElementById('fullName').value = account.fullName;
  document.getElementById('pName').textContent = account.fullName;
  document.getElementById('email').value = account.email;
  document.getElementById('email').readOnly = true;

  const applicationResponse = await fetch('/api/members/me');
  if (!applicationResponse.ok) {
    throw new Error('Unable to check your membership application. Please refresh and try again.');
  }

  const application = await applicationResponse.json();
  if (application.submitted) {
    document.getElementById('pID').textContent = application.memberId;
    document.getElementById('pName').textContent = application.fullName || 'Your name';
    document.getElementById('pCountry').textContent = application.country || '-';
    const membershipTypes = { member: 'Member', donor: 'Donor', investor: 'Investor' };
    document.getElementById('pStatus').textContent = membershipTypes[application.membershipType] || '-';
    for (const element of registrationForm.elements) {
      element.disabled = true;
    }
    if (application.hasPhoto) {
      downloadMemberIdButton.hidden = false;
      passportPhotoUploadMessage.textContent = 'Your passport photo is uploaded. Your Member ID PDF is ready to download.';
      passportPhotoUploadMessage.classList.add('is-success');
      passportPhotoUploadMessage.hidden = false;
      showRegistrationMessage(`Your membership application is already submitted. Your Member ID is ${application.memberId}.`);
    } else {
      passportPhotoInput.disabled = false;
      uploadPassportPhotoButton.disabled = false;
      uploadPassportPhotoButton.hidden = false;
      showRegistrationMessage(`Your membership application is already submitted. Add a passport photo to create your Member ID PDF.`);
    }
    return;
  }
  submitButton.disabled = false;
}

registrationForm.addEventListener('submit', async event => {
  event.preventDefault();
  registrationMessage.hidden = true;
  submitButton.disabled = true;

  const application = {
    fullName: document.getElementById('fullName').value.trim(),
    dob: document.getElementById('dob').value,
    gender: document.getElementById('gender').value,
    nin: document.getElementById('nin').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    whatsapp: document.getElementById('whatsapp').value.trim(),
    email: document.getElementById('email').value,
    country: document.getElementById('country').value,
    city: document.getElementById('city').value.trim(),
    status: document.getElementById('memberStatus').value,
    membershipType: document.getElementById('membershipType').value,
    agency: document.getElementById('agency').value.trim(),
    servicesNeeded: Array.from(document.querySelectorAll('.checkbox-grid input:checked'))
      .map(checkbox => checkbox.value),
    additionalInformation: document.getElementById('additionalInformation').value.trim(),
    emergencyName: document.getElementById('emName').value.trim(),
    emergencyPhone: document.getElementById('emPhone').value.trim()
  };

  const formData = new FormData();
  formData.append('application', new Blob([JSON.stringify(application)], {
    type: 'application/json'
  }));
  formData.append('passportPhoto', passportPhotoInput.files[0]);
  if (identityDocumentInput.files[0]) {
    formData.append('identityDocument', identityDocumentInput.files[0]);
  }
  for (const file of supportingDocumentsInput.files) {
    formData.append('supportingDocuments', file);
  }

  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/members', {
      method: 'POST',
      headers: { 'X-XSRF-TOKEN': csrfToken },
      body: formData
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || result.error || result.message || 'Unable to submit your application. Please try again.');
    }

    const result = await response.json();
    document.getElementById('pID').textContent = result.memberId;
    downloadMemberIdButton.hidden = false;
    passportPhotoUploadMessage.textContent = 'Photo uploaded successfully. Your Member ID PDF is ready to download.';
    passportPhotoUploadMessage.classList.add('is-success');
    passportPhotoUploadMessage.hidden = false;
    showRegistrationMessage(`Your membership application has been submitted. Your Member ID is ${result.memberId}.`);
    registrationForm.reset();
    if (passportPhotoPreviewUrl) {
      URL.revokeObjectURL(passportPhotoPreviewUrl);
      passportPhotoPreviewUrl = '';
    }
    passportPhotoPreview.hidden = true;
    passportPhotoPreview.removeAttribute('src');
    passportPhotoPreview.nextElementSibling.hidden = false;
    passportPhotoStatus.textContent = 'No photo selected';
    identityDocumentInput.setCustomValidity('');
    supportingDocumentsInput.setCustomValidity('');
    document.getElementById('identityDocumentStatus').textContent = 'No file selected';
    document.getElementById('supportingDocumentsStatus').textContent = 'No files selected';
    for (const element of registrationForm.elements) {
      element.disabled = true;
    }
  } catch (error) {
    showRegistrationMessage(error.message || 'Unable to submit your application. Please try again.', true);
    submitButton.disabled = false;
  }
});

initializeMembershipForm().catch(error => {
  showRegistrationMessage(error.message || 'Unable to load your membership form. Please try again.', true);
});
