
  (function () {
    // Need to get these from the DOM or passed in some other way since we can't use liquid block.id or block.settings directly in .js asset
    // We will look for a data attribute on the script tag or expect the container to exist with a specific class/id pattern if possible,
    // OR we wrap this in a function that takes arguments and call it from Liquid.
    
    // Better approach: Define a global function or class, and initialize it from the liquid file.
    
    window.GDCustomForm = {
        init: function(blockId, formId) {
            const container = document.getElementById('gd-custom-form-' + blockId);
        
            if (!formId) {
              container.innerHTML = '<div class="gd-form-message gd-form-error">Please enter a valid Form ID in the block settings.</div>';
              return;
            }
        
            this.fetchForm(container, formId);
        },

        fetchForm: async function(container, formId) {
            try {
                const res = await fetch(`/apps/proxy/forms?id=${formId}`);
                if (!res.ok) throw new Error('Failed to load form');
                const data = await res.json();
                this.renderForm(container, data);
            } catch (err) {
                container.innerHTML = `<div class="gd-form-message gd-form-error">Error loading form: ${err.message}</div>`;
            }
        },

        renderForm: function(container, form) {
            container.innerHTML = '';
            
            const settings = form.settings ? JSON.parse(form.settings) : {};
            
            // Header
            const headerDiv = document.createElement('div');
            headerDiv.className = 'gd-form-header';
            
            if (settings.title) {
                const h2 = document.createElement('h2');
                h2.className = 'gd-form-title';
                h2.innerText = settings.title;
                headerDiv.appendChild(h2);
            }
            
            if (settings.subtitle) {
                const p = document.createElement('div');
                p.className = 'gd-form-subtitle';
                p.innerText = settings.subtitle;
                headerDiv.appendChild(p);
            }
            container.appendChild(headerDiv);

            const formEl = document.createElement('form');
            const formContainer = document.createElement('div');
            formContainer.className = 'gd-form-container';

            const submitBtn = document.createElement('button');
            submitBtn.type = 'submit';
            submitBtn.className = 'gd-form-submit';
            submitBtn.innerText = settings.submitText || 'Submit';
            
            // Submit Button Styles
            const submitNormalBg = settings.submitColor || '#000';
            const submitHoverBg = settings.submitHoverColor || '#333';
            const submitActiveBg = settings.submitActiveColor || '#555';
            const submitTextCol = settings.submitTextColor || '#fff';

            submitBtn.style.backgroundColor = submitNormalBg;
            submitBtn.style.color = submitTextCol;
            
            // Submit Button Interactions
            submitBtn.onmouseover = () => { if(!submitBtn.disabled) submitBtn.style.backgroundColor = submitHoverBg; };
            submitBtn.onmouseout = () => { if(!submitBtn.disabled) submitBtn.style.backgroundColor = submitNormalBg; };
            submitBtn.onmousedown = () => { if(!submitBtn.disabled) submitBtn.style.backgroundColor = submitActiveBg; };
            submitBtn.onmouseup = () => { if(!submitBtn.disabled) submitBtn.style.backgroundColor = submitHoverBg; };

            
            formEl.appendChild(submitBtn);

            form.fields.forEach((field) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'gd-form-field-wrapper';
                wrapper.style.width = (field.width === '50') ? '50%' : '100%';

                if (field.type === 'header') {
                    const hDiv = document.createElement('div');
                    hDiv.className = 'gd-form-field-header';
                    hDiv.innerHTML = `<h3>${field.label}</h3>`;
                    wrapper.appendChild(hDiv);
                } else {
                    if (field.type !== 'checkbox') {
                        const label = document.createElement('label');
                        label.className = 'gd-form-label';
                        label.innerText = field.label;
                        label.style.color = settings.labelColor || '#000'; // Label Color
                        
                        if (field.required) {
                            const span = document.createElement('span');
                            span.innerText = ' *';
                            span.style.color = settings.requiredColor || 'red'; // Required Color
                            label.appendChild(span);
                        }
                        wrapper.appendChild(label);
                    }

                    let input;
                    const commonInputStyles = (el) => {
                        el.style.borderColor = settings.borderColor || '#ccc';
                        el.style.borderRadius = (settings.borderRadius ?? 4) + 'px';
                        el.style.padding = (settings.fieldPadding ?? 12) + 'px';
                    };

                    if (field.type === 'textarea') {
                    input = document.createElement('textarea');
                    input.className = 'gd-form-input';
                    input.rows = 4;
                    commonInputStyles(input);
                    } else if (field.type === 'select') {
                    input = document.createElement('select');
                    input.className = 'gd-form-input';
                    commonInputStyles(input);
                    const defaultOpt = document.createElement('option');
                    defaultOpt.text = '- Select -';
                    defaultOpt.value = '';
                    input.appendChild(defaultOpt);

                    field.options.forEach((opt) => {
                        const o = document.createElement('option');
                        o.text = opt;
                        o.value = opt;
                        input.appendChild(o);
                    });
                    } else if (field.type === 'radio') {
                        const radioGroup = document.createElement('div');
                        radioGroup.className = 'gd-form-radio-group';
                        radioGroup.style.padding = '5px 0';
                        
                        field.options.forEach(opt => {
                            const rWrapper = document.createElement('div');
                            rWrapper.style.display = 'flex';
                            rWrapper.style.alignItems = 'center';
                            rWrapper.style.marginBottom = '5px';
                            
                            const rInput = document.createElement('input');
                            rInput.type = 'radio';
                            rInput.name = field.id;
                            rInput.value = opt;
                            // Radio required logic handled by browser if name matches
                            if(field.required) rInput.required = true;
                            
                            const rLabel = document.createElement('span');
                            rLabel.innerText = opt;
                            rLabel.style.marginLeft = '8px';
                            rLabel.style.color = settings.labelColor || '#000';
                            
                            rWrapper.appendChild(rInput);
                            rWrapper.appendChild(rLabel);
                            radioGroup.appendChild(rWrapper);
                        });
                        wrapper.appendChild(radioGroup);
                    } else if (field.type === 'checkbox') {
                    const cbWrapper = document.createElement('div');
                    cbWrapper.className = 'gd-form-checkbox-wrapper';
                    
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    
                    const cbLabel = document.createElement('label');
                    cbLabel.innerText = field.placeholder || field.label; 
                    cbLabel.style.color = settings.labelColor || '#000';

                    if(field.required) {
                        const span = document.createElement('span');
                        span.innerText = ' *';
                        span.style.color = settings.requiredColor || 'red';
                        cbLabel.appendChild(span);
                    }

                    cbWrapper.appendChild(input);
                    cbWrapper.appendChild(cbLabel);
                    wrapper.appendChild(cbWrapper);
                    } else {
                    // Handles text, email, number, date, file
                    input = document.createElement('input');
                    input.type = field.type;
                    input.className = 'gd-form-input';
                    commonInputStyles(input);
                    }

                    if (field.type !== 'checkbox' && field.type !== 'radio') {
                        if (field.placeholder && field.type !== 'date' && field.type !== 'file') input.placeholder = field.placeholder;
                        wrapper.appendChild(input);
                    }
                    
                    if (input) {
                        input.name = field.id;
                        if (field.required) input.required = true;
                    }
                }

                formContainer.appendChild(wrapper);
            });
            
            formEl.appendChild(formContainer);
            formEl.appendChild(submitBtn); // Moving submit button to end

            formEl.onsubmit = async (e) => {
                e.preventDefault();
                submitBtn.disabled = true;
                const originalText = submitBtn.innerText;
                submitBtn.innerText = 'Please wait...';

                const formData = {};
                
                const processField = async (f) => {
                if (f.type === 'header') return;
                
                const el = formEl.elements[f.id];
                if (!el) return;

                if (f.type === 'checkbox') {
                    formData[f.label] = el.checked ? 'Yes' : 'No';
                } else if (f.type === 'file') {
                    if (el.files && el.files[0]) {
                        const getBase64 = (file) => {
                            return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.readAsDataURL(file);
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = error => reject(error);
                            });
                        };
                        
                        try {
                            const file = el.files[0];
                            const base64 = await getBase64(file);
                            // Store as an object we can identify later
                            formData[f.label] = {
                                _type: 'file',
                                name: file.name,
                                content: base64
                            };
                        } catch (err) {
                            console.error("Error reading file", err);
                            formData[f.label] = "Error uploading file";
                        }
                    } else {
                        formData[f.label] = "";
                    }
                } else {
                    formData[f.label] = el.value;
                }
                };

                try {
                await Promise.all(form.fields.map(processField));

                const res = await fetch('/apps/proxy/forms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ formId: form.id, data: formData }),
                });

                if (res.ok) {
                    container.innerHTML = `<div class="gd-form-message gd-form-success">${settings.successMessage || 'Thank you! Your submission has been received.'}</div>`;
                } else {
                    throw new Error('Submission failed');
                }
                } catch (err) {
                console.error(err);
                const msg = document.createElement('div');
                msg.className = 'gd-form-message gd-form-error';
                msg.innerText = 'Error submitting form. Please try again.';
                formEl.insertAdjacentElement('afterend', msg);
                
                submitBtn.disabled = false;
                submitBtn.innerText = originalText;
                }
            };

            container.appendChild(formEl);
        }
    };
  })();
