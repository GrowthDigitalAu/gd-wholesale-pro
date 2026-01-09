
  (function () {

    
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
            
            const headerDiv = document.createElement('div');
            headerDiv.className = 'gd-form-header';
            headerDiv.style.textAlign = 'center';
            headerDiv.style.padding = '0 10px';
            
            if (form.title) {
                const h2 = document.createElement('h2');
                h2.className = 'gd-form-title';
                h2.innerText = form.title;
                h2.style.marginBottom = '10px';
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
            formContainer.style.display = 'flex';
            formContainer.style.flexWrap = 'wrap';
            formContainer.style.margin = '0 -10px';

            const submitBtn = document.createElement('button');
            submitBtn.type = 'submit';
            submitBtn.className = 'gd-form-submit';
            submitBtn.innerText = settings.submitText || 'Submit';
            
            const submitNormalBg = settings.submitColor || '#000';

            const submitTextCol = settings.submitTextColor || '#fff';

            submitBtn.style.backgroundColor = submitNormalBg;
            submitBtn.style.color = submitTextCol;
            submitBtn.style.width = '100%';
            
            formEl.appendChild(submitBtn);

            form.fields.forEach((field) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'gd-form-field-wrapper gd-form-' + field.type + '-' + field.id + '-wrapper';
                wrapper.style.width = (field.width === '50') ? '50%' : '100%';
                wrapper.style.padding = '0 10px';
                wrapper.style.boxSizing = 'border-box';
                wrapper.style.marginBottom = '15px';

                if (field.type === 'header') {
                    const hDiv = document.createElement('div');
                    hDiv.className = 'gd-form-field-header';
                    hDiv.innerHTML = `<h3>${field.label}</h3>`;
                    wrapper.appendChild(hDiv);
                } else {
                    const hasOptions = field.type === 'checkbox' && field.options && field.options.length > 0;

                    if (field.type !== 'checkbox' || hasOptions) {
                        const isGroup = field.type === 'radio' || hasOptions;
                        const label = document.createElement(isGroup ? 'div' : 'label');
                        label.className = 'gd-form-label';
                        if (!isGroup) label.htmlFor = 'app-' + field.id;
                        label.innerText = field.label;
                        label.style.color = settings.labelColor || '#000';
                        label.style.textAlign = 'left';
                        label.style.display = 'block';
                        
                        if (field.required) {
                            const span = document.createElement('span');
                            span.innerText = ' *';
                            span.style.color = settings.requiredColor || 'red';
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
                        input.id = 'app-' + field.id;
                        input.className = 'gd-form-input gd-form-textarea-' + field.id;
                        input.rows = 4;
                        commonInputStyles(input);
                        if (field.required) input.required = true;
                    } else if (field.type === 'select') {
                        input = document.createElement('select');
                        input.id = 'app-' + field.id;
                        input.className = 'gd-form-input gd-form-select-' + field.id;
                        if (field.required) input.required = true;
                        commonInputStyles(input);

                        const placeholderColor = settings.placeholderColor || '#999';
                        const textColor = settings.color || '#000'; 
                        
                        input.style.color = placeholderColor;

                        input.addEventListener('change', function() {
                            this.style.color = this.value === '' ? placeholderColor : textColor;
                        });

                        const defaultOpt = document.createElement('option');
                        defaultOpt.text = field.placeholder || 'Choose option...';
                        defaultOpt.value = '';
                        defaultOpt.selected = true;
                        input.appendChild(defaultOpt);

                        field.options.forEach((opt) => {
                            const o = document.createElement('option');
                            o.text = opt;
                            o.value = opt;
                            o.style.color = textColor;
                            input.appendChild(o);
                        });
                    } else if (field.type === 'radio') {

                        const radioGroup = document.createElement('div');
                        radioGroup.className = 'gd-form-radio-group';
                        radioGroup.style.padding = '5px 0';
                        
                        field.options.forEach((opt, idx) => {
                            const rWrapper = document.createElement('div');
                            rWrapper.style.display = 'flex';
                            rWrapper.style.alignItems = 'center';
                            rWrapper.style.marginBottom = '5px';
                            
                            const optId = 'app-' + field.id + '_' + idx;

                            const rInput = document.createElement('input');
                            rInput.type = 'radio';
                            rInput.id = optId;
                            rInput.name = field.id;
                            rInput.value = opt;

                            if(field.required) rInput.required = true;
                            
                            const rLabel = document.createElement('label');
                            rLabel.innerText = opt;
                            rLabel.htmlFor = optId;
                            rLabel.style.marginLeft = '8px';
                            rLabel.style.color = settings.labelColor || '#000';
                            
                            rWrapper.appendChild(rInput);
                            rWrapper.appendChild(rLabel);
                            radioGroup.appendChild(rWrapper);
                        });
                        wrapper.appendChild(radioGroup);
                    } else if (field.type === 'checkbox') {
                        if (field.options && field.options.length > 0) {
                             const cbGroup = document.createElement('div');
                             cbGroup.className = 'gd-form-checkbox-group';
                             cbGroup.style.padding = '5px 0';

                             field.options.forEach((opt, idx) => {
                                const cbWrapper = document.createElement('div');
                                cbWrapper.style.display = 'flex';
                                cbWrapper.style.alignItems = 'center';
                                cbWrapper.style.marginBottom = '5px';

                                const optId = 'app-' + field.id + '_' + idx;

                                const cbInput = document.createElement('input');
                                cbInput.type = 'checkbox';
                                cbInput.id = optId;
                                cbInput.name = field.id;
                                cbInput.value = opt;
                                
                                const cbLabel = document.createElement('label');
                                cbLabel.innerText = opt;
                                cbLabel.htmlFor = optId;
                                cbLabel.style.marginLeft = '8px';
                                cbLabel.style.color = settings.labelColor || '#000';

                                cbWrapper.appendChild(cbInput);
                                cbWrapper.appendChild(cbLabel);
                                cbGroup.appendChild(cbWrapper);
                             });
                             wrapper.appendChild(cbGroup);
                        } else {

                            const cbWrapper = document.createElement('div');
                            cbWrapper.className = 'gd-form-checkbox-wrapper';
                            
                            input = document.createElement('input');
                            input.type = 'checkbox';
                            input.id = 'app-' + field.id;
                            input.name = field.id;
                            
                            const cbLabel = document.createElement('label');
                            cbLabel.innerText = field.placeholder || field.label;
                            cbLabel.htmlFor = 'app-' + field.id; 
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
                        }
                    } else if (field.type === 'phone') {
                        const phoneWrapper = document.createElement('div');
                        phoneWrapper.style.display = 'flex';
                        phoneWrapper.style.gap = '8px';

                        const codeSelect = document.createElement('select');
                        codeSelect.name = field.id + '_code';
                        codeSelect.className = 'gd-form-input gd-form-phone-code-' + field.id;
                        commonInputStyles(codeSelect);
                        codeSelect.style.width = '100px'; 
                        codeSelect.style.minWidth = '100px';

                        const codes = window.GD_COUNTRY_CODES || [];
                        codes.forEach(c => {
                            const opt = document.createElement('option');
                            opt.value = c.code;
                            opt.text = c.label;
                            codeSelect.appendChild(opt);
                        });
                        // Default to India or US or first
                        codeSelect.value = '+91';  

                        input = document.createElement('input');
                        input.type = 'tel';
                        input.id = 'app-' + field.id;
                        input.name = field.id + '_num';
                        input.className = 'gd-form-input gd-form-phone-' + field.id;
                        input.placeholder = field.placeholder;
                        commonInputStyles(input);
                        input.style.flex = '1';
                        
                        input.addEventListener('input', function(e) {
                            this.value = this.value.replace(/[^0-9]/g, '');
                        });

                        phoneWrapper.appendChild(codeSelect);
                        phoneWrapper.appendChild(input);
                        wrapper.appendChild(phoneWrapper);

                        // Prevent the default input append below
                        input = null; 
                    } else {

                    input = document.createElement('input');
                    input.type = field.type;
                    input.id = 'app-' + field.id;
                    input.className = 'gd-form-input gd-form-' + field.type + '-' + field.id;
                    commonInputStyles(input);
                    }

                    if (field.type !== 'checkbox' && field.type !== 'radio' && field.type !== 'phone') {
                        if (field.placeholder && field.type !== 'date' && field.type !== 'file') input.placeholder = field.placeholder;
                        wrapper.appendChild(input);
                    }
                    
                    if (input) {
                        input.name = field.id;
                        if (field.required) {
                             if (field.type === 'phone') {
                                 // Handled by the _num input
                             } else {
                                input.required = true;
                             }
                        }
                    }
                    if (field.type === 'phone' && field.required) {
                         // We set required on the number input inside the if block above, but input is null now.
                         // We need to set it on the element we created.
                         // Actually, we lost reference to 'input' var for phone. 
                         // Let's refactor slightly or just find it.
                         const numInput = wrapper.querySelector(`input[name="${field.id}_num"]`);
                         if(numInput) numInput.required = true;
                    }
                }

                formContainer.appendChild(wrapper);
            });
            
            const footerDiv = document.createElement('div');
            footerDiv.className = 'gd-form-footer';
            footerDiv.style.textAlign = 'center';
            footerDiv.style.width = '75%';
            footerDiv.style.margin = '5px auto';
            footerDiv.style.padding = '0 10px';

            formEl.appendChild(formContainer);
            footerDiv.appendChild(submitBtn);

            if (settings.disclaimer) {
                const disclaimer = document.createElement('p');
                disclaimer.innerText = settings.disclaimer;
                disclaimer.className = 'gd-form-disclaimer';
                disclaimer.style.marginTop = '10px';
                disclaimer.style.fontSize = '12px';
                disclaimer.style.color = '#666';
                footerDiv.appendChild(disclaimer);
            }

            formEl.appendChild(footerDiv);

            formEl.onsubmit = async (e) => {
                e.preventDefault();
                submitBtn.disabled = true;
                const originalText = submitBtn.innerText;
                submitBtn.innerText = 'Please wait...';

                const formData = {};
                
                const processField = async (f) => {
                if (f.type === 'header') return;
                
                const el = formEl.elements[f.id];

                if (!el && f.type !== 'phone') return;

                if (f.type === 'checkbox') {
                    if (el instanceof NodeList || (el instanceof RadioNodeList && el.length > 1)) {

                         const checked = [];
                         el.forEach(node => { if (node.checked) checked.push(node.value); });
                         formData[f.label] = checked.join(', ');
                    } else if (f.options && f.options.length > 0) {

                         formData[f.label] = el.checked ? el.value : '';
                    } else {

                         formData[f.label] = el.checked ? 'Yes' : 'No';
                    }
                } else if (f.type === 'radio') {

                     formData[f.label] = el.value;
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
                } else if (f.type === 'phone') {
                    const code = formEl.elements[f.id + '_code'].value;
                    const num = formEl.elements[f.id + '_num'].value;
                    formData[f.label] = code + num;
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
