// node_modules/wirejs-dom/lib/v2/util.js
function randomId() {
  return `${(/* @__PURE__ */ new Date()).getTime()}_${Math.floor(Math.random() * 1e6)}`;
}
function matchingAttribute(node2, id2) {
  for (const attribute3 of node2.attributes) {
    if (attribute3.value === id2)
      return attribute3;
  }
  return null;
}
function getAttributeUnder(root, id2) {
  const q = [root];
  while (q.length > 0) {
    const node2 = q.shift();
    if (!node2)
      return;
    const attribute3 = matchingAttribute(node2, id2);
    if (attribute3) {
      return attribute3;
    }
    for (const child of node2.children) {
      q.push(child);
    }
  }
}
function isPromise(o) {
  return !!o && typeof o === "object" && "then" in o && typeof o.then === "function";
}

// node_modules/wirejs-dom/lib/v2/components/dom-events.js
var monitoredNodes = /* @__PURE__ */ new Set();
var registeredCallbacks = /* @__PURE__ */ new WeakMap();
var nodeDomStatus = /* @__PURE__ */ new WeakMap();
var observer = null;
function ensureRunning() {
  if (observer)
    return observer;
  observer = new MutationObserver(() => {
    for (const nodeRef of [...monitoredNodes]) {
      const node2 = nodeRef.deref();
      if (node2) {
        const wasInDom = nodeDomStatus.get(node2);
        const isInDom = document.contains(node2);
        const wasAdded = isInDom && !wasInDom;
        const wasRemoved = wasInDom && !isInDom;
        nodeDomStatus.set(node2, isInDom);
        if (wasAdded) {
          registeredCallbacks.get(node2)?.onadd();
        } else if (wasRemoved) {
          registeredCallbacks.get(node2)?.onremove();
        }
      } else {
        monitoredNodes.delete(nodeRef);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
function registerNodeDomCallbacks(node2, callbacks) {
  ensureRunning();
  monitoredNodes.add(new WeakRef(node2));
  registeredCallbacks.set(node2, callbacks);
  nodeDomStatus.set(node2, document.contains(node2));
}
function tryToCall(f) {
  try {
    f();
  } catch (e) {
    console.error(e);
  }
}
function addWatcherHooks(node2) {
  const onAddWatchers = [];
  const onRemoveWatchers = [];
  let registered = false;
  const ensureCallbacksAreRegistered = () => {
    if (registered)
      return;
    registerNodeDomCallbacks(node2, {
      onadd: () => onAddWatchers.forEach(tryToCall),
      onremove: () => onRemoveWatchers.forEach(tryToCall)
    });
    registered = true;
  };
  node2.onadd = (f) => {
    ensureCallbacksAreRegistered();
    onAddWatchers.push(() => f(node2));
    return node2;
  };
  node2.onremove = (f) => {
    ensureCallbacksAreRegistered();
    onRemoveWatchers.push(() => f(node2));
    return node2;
  };
}

// node_modules/wirejs-dom/lib/v2/components/html.js
function html(raw, ...builders) {
  const adjustedBuilders = builders.map((b) => {
    if (typeof b === "function") {
      const id2 = randomId();
      return {
        id: id2,
        toString() {
          return id2;
        },
        handler: b
      };
    } else if (Array.isArray(b)) {
      const phId = randomId();
      return {
        id: null,
        toString() {
          return `<ph data-id=${phId}></ph>`;
        },
        bless(ctx) {
          const ph = ctx.container.querySelector(`[data-id="${phId}"]`);
          b.forEach((_b) => _b instanceof Node ? ph.parentNode?.insertBefore(_b, ph) : ph.parentNode?.insertBefore(document.createTextNode(String(_b)), ph));
          ph.parentNode?.removeChild(ph);
        }
      };
    } else if (b instanceof Node) {
      const phId = randomId();
      return {
        id: null,
        toString() {
          return `<ph data-id=${phId}></ph>`;
        },
        bless(ctx) {
          const ph = ctx.container.querySelector(`[data-id="${phId}"]`);
          ph.parentNode?.replaceChild(b, ph);
        }
      };
    } else {
      return b;
    }
  });
  const markup = String.raw({ raw }, ...adjustedBuilders).trim();
  const firstNode = markup.trim().match(/<!?(\w+)/)[1].toLocaleLowerCase();
  const parser = new DOMParser();
  const container = parser.parseFromString(markup, "text/html");
  const node2 = {
    doctype: container.documentElement,
    html: container.documentElement,
    head: container.head,
    body: container.body
  }[firstNode] || container.body.firstElementChild;
  node2.data = {};
  for (const builder of adjustedBuilders) {
    if (!builder)
      continue;
    if (typeof builder !== "object")
      continue;
    let accessor = void 0;
    if ("handler" in builder && typeof builder.handler === "function") {
      const fAttr = getAttributeUnder(node2, builder.id);
      const el = fAttr?.ownerElement;
      el?.removeAttribute(fAttr.name);
      el && (el[fAttr.name] = builder.handler);
    }
    if ("bless" in builder && typeof builder.bless === "function") {
      accessor = builder.bless({ container: node2, data: node2.data });
    }
    if ("id" in builder && typeof builder.id === "string") {
      appendAccessor(node2, builder.id, accessor);
    }
  }
  addWatcherHooks(node2);
  addExtends(node2);
  return node2;
}
var knownAccessors = /* @__PURE__ */ new WeakMap();
function appendAccessor(node2, propName, accessor) {
  if (!knownAccessors.has(node2.data)) {
    const dataProp = node2.data;
    knownAccessors.set(dataProp, {});
    Object.defineProperty(node2, "data", {
      enumerable: true,
      get() {
        return dataProp;
      },
      set(newData) {
        for (const [k, v] of Object.entries(newData)) {
          if (
            // when ...
            dataProp[k] instanceof Node && typeof dataProp[k].data === "object" && !(v instanceof Node) && typeof v.data === "object"
          ) {
            dataProp[k].data = v.data;
          } else {
            dataProp[k] = v;
          }
        }
      }
    });
  }
  const nodeAccessor = knownAccessors.get(node2.data);
  if (!nodeAccessor[propName]) {
    const nodePropAccessors = [];
    nodeAccessor[propName] = nodePropAccessors;
    Object.defineProperty(node2.data, propName, {
      get() {
        return nodePropAccessors[0]?.get();
      },
      set(v) {
        for (const a of nodePropAccessors) {
          a.set(v);
        }
      },
      enumerable: true
    });
  }
  accessor && nodeAccessor[propName].push(accessor);
}
function addExtends(target) {
  target.extend = (buildExtensions) => {
    const extensions = buildExtensions(target);
    mergeExtensionsIn(target, extensions);
    return target;
  };
}
function mergeExtensionsIn(target, extensions) {
  for (const [k, v] of Object.entries(extensions)) {
    if (k in target) {
      if (typeof v === "object") {
        mergeExtensionsIn(target[k], v);
      } else {
        target[k] = v;
      }
    } else {
      target[k] = v;
    }
  }
}

// node_modules/wirejs-dom/lib/v2/internals.js
var __dataType = Symbol("__dataType");
var __renderedType = Symbol("_renderedType");

// node_modules/wirejs-dom/lib/v2/hooks/attribute.js
function attribute(id2, ...args) {
  const [mapperOrDataA, mapperOrDataB] = args;
  const map = typeof mapperOrDataA === "function" ? mapperOrDataA : typeof mapperOrDataB === "function" ? mapperOrDataB : (item) => item;
  const initialValue = typeof mapperOrDataA === "function" ? mapperOrDataB : mapperOrDataA;
  const sentinelId = randomId();
  return {
    id: id2,
    toString: () => sentinelId,
    bless: (context) => {
      const attr = getAttributeUnder(context.container, sentinelId);
      if (!attr)
        return;
      const node2 = attr.ownerElement;
      const attrName = attr.name;
      attr.value = "";
      let innerValue = initialValue;
      node2[attrName] = map(innerValue);
      function doSet(value) {
        innerValue = value;
        node2[attrName] = map(value);
      }
      if (node2.tagName === "INPUT" && attrName === "value" && typeof node2["oninput"] !== "function") {
        node2["oninput"] = () => {
          context.data[id2] = map(node2[attrName]);
        };
      }
      return {
        get() {
          return innerValue;
        },
        set(value) {
          if (isPromise(value)) {
            value.then((v) => doSet(v));
          } else {
            doSet(value);
          }
        }
      };
    },
    [__dataType]: {},
    [__renderedType]: {}
  };
}

// node_modules/wirejs-dom/lib/v2/hooks/id.js
function id(id2, type) {
  return {
    id: id2,
    toString: () => `data-id="${id2}"`,
    bless: (context) => {
      let node2 = context.container.querySelector(`[data-id="${id2}"]`);
      return {
        get() {
          return node2;
        },
        set(value) {
          function setNode(newValue) {
            const replacement = newValue || document.createTextNode("");
            try {
              node2?.parentNode?.replaceChild(replacement, node2);
              node2 = replacement;
            } catch (error) {
              console.log("Skipping replacement of node with non-node new value.", { node: node2, newValue });
            }
          }
          if (isPromise(value)) {
            value.then((v) => setNode(v));
          } else {
            setNode(value);
          }
        }
      };
    },
    [__dataType]: {},
    [__renderedType]: {}
  };
}

// node_modules/wirejs-dom/lib/v2/hooks/node.js
function node(id2, ...args) {
  const [mapperOrDataA, mapperOrDataB] = args;
  const map = typeof mapperOrDataA === "function" ? mapperOrDataA : typeof mapperOrDataB === "function" ? mapperOrDataB : (item) => item instanceof Element || item instanceof Node ? item : document.createTextNode(item ? String(item) : "");
  const initialValue = typeof mapperOrDataA === "function" ? mapperOrDataB : mapperOrDataA;
  const sentinelId = randomId();
  return {
    id: id2,
    toString: () => `<ph data-id=${sentinelId}></ph>`,
    bless: (context) => {
      let innerValue = initialValue;
      let node2 = map(innerValue);
      const placeHolder = context.container.querySelector(`[data-id="${sentinelId}"]`);
      placeHolder.parentNode?.replaceChild(node2, placeHolder);
      function setValue(value) {
        const newNode = map(value);
        node2.parentNode?.replaceChild(newNode, node2);
        node2 = newNode;
      }
      return {
        get() {
          return innerValue;
        },
        set(value) {
          if (isPromise(value)) {
            value.then((v) => {
              innerValue = v;
              setValue(v);
            });
          } else {
            innerValue = value;
            setValue(value);
          }
        }
      };
    },
    [__dataType]: {},
    [__renderedType]: {}
  };
}

// src/components/authenticator.ts
var authenticatoraction = (action, act) => {
  const inputs = Object.entries(action.fields || []).map(([name, { label, type }]) => {
    const id2 = `input_${Math.floor(Math.random() * 1e6)}`;
    const input = html`<div>
			<label for=${id2}>${label}</label>
			<br />
			<input
				id=${id2}
				name=${name}
				type=${type}
				value=${attribute("value", "")}
				style='width: calc(100% - 1rem); margin-bottom: 0.5rem;'
			/>
		</div>`.extend((self) => ({
      data: { name }
    }));
    return input;
  });
  const buttons = action.buttons?.map((b) => html`<p>
		<button type='submit' value='${b}'>${b}</button>
	</p>`);
  const link = buttons ? void 0 : [
    html`<p><a
			style='cursor: pointer; font-weight: bold;'
			onclick=${() => act({ key: action.key })}
		>${action.name}</a></p>`
  ];
  const actors = link ?? buttons;
  if (action.fields && Object.keys(action.fields).length > 0) {
    return html`<authenticatoraction>
			<div>
				<h4 style='margin-top: 1rem; margin-bottom: 0.5rem;'>${action.name}</h4>
				<form
					onsubmit=${(evt) => {
      evt.preventDefault();
      act({
        key: action.key,
        verb: evt.submitter?.value,
        inputs: Object.fromEntries(inputs.map((input) => [
          input.data.name,
          input.data.value
        ]))
      });
    }}
				>
					${inputs}
					${actors}
				</form>
				<hr style='width: 33%; height: 1px; border: none; background: silver;' />
			</div>
		</authenticatoraction>`;
  } else {
    return html`<authenticatoraction>
			${actors}
		</authenticatoraction>`;
  }
};
var authenticator = (stateManager, initialState) => {
  const listeners = /* @__PURE__ */ new Set();
  let lastKnownState = void 0;
  const self = html`<authenticator style='display: block; min-width: 15em;'>
		${node("state", html`<span>Loading ...</span>`)}
	</authenticator>`.extend(() => ({
    renderState(state) {
      if ("errors" in state && state.errors) {
        alert(state.errors.map((e) => e.message).join("\n\n"));
      } else {
        lastKnownState = state;
        self.data.state = html`<div>
					<div>${lastKnownState.message || ""}</div>
					<div>${Object.entries(lastKnownState.actions).map(([_key, action]) => {
          return authenticatoraction({ ...action }, async (act) => {
            self.renderState(await stateManager.setState(null, act));
          });
        })}</div>
				</div>`;
      }
      for (const listener of listeners) {
        try {
          listener(state);
        } catch (error) {
          console.error("Error calling auth state listener.");
        }
      }
    }
  })).onadd(async (self2) => {
    if (initialState) {
      console.log("authenticator render state");
      self2.renderState(initialState);
    }
  }).extend((self2) => ({
    data: {
      setState: (state) => self2.renderState(state),
      onchange: (callback) => {
        listeners.add(callback);
      },
      removeonchange: (callback) => {
        listeners.delete(callback);
      },
      focus: () => {
        [...self2.getElementsByTagName("input")].shift()?.focus();
      },
      get lastKnownState() {
        return lastKnownState;
      }
    }
  }));
  return self;
};

// src/components/account-menu.ts
var accountMenu = ({ api, initialState }) => {
  const uiState = {
    expanded: false
  };
  const listeners = /* @__PURE__ */ new Set();
  const listenForClose = (event) => {
    if (event.type === "click" && !self.data.menu.contains(event.target) || event.type === "keyup" && event.key === "Escape") {
      close();
    }
  };
  const close = () => {
    uiState.expanded = false;
    updateStyleToMatchState();
    document.removeEventListener("click", listenForClose);
    document.removeEventListener("keyup", listenForClose);
  };
  const removeListenForClose = () => {
    document.removeEventListener("click", listenForClose);
    document.removeEventListener("keyup", listenForClose);
  };
  const updateStyleToMatchState = () => {
    self.data.menu.style.display = uiState.expanded ? "" : "none";
    const position = self.getBoundingClientRect();
    self.data.menu.style.top = `${position.bottom + 1}px`;
    self.data.menu.style.right = `${document.body.clientWidth - position.right + 16}px`;
  };
  const authenticatorNode = authenticator(api, initialState);
  authenticatorNode.data.onchange((state) => {
    self.data.user = state.user?.username || "";
    close();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("Error calling auth state listener.");
      }
    }
  });
  const self = html`<accountmenu style='display: inline-block;'>
		<div
			style='display: inline-block;'
		>${node(
    "user",
    initialState?.user?.username || "",
    (name) => name ? html`<b>${name}</b>` : html`<i>Anonymous</i>`
  )}</div>
		<div style='
				display: inline-block;
				border: 1px solid silver;
				border-radius: 0.25rem;
				cursor: pointer;
				padding: 0 0.25em;
			'
			onclick=${() => {
    uiState.expanded = !uiState.expanded;
    updateStyleToMatchState();
    if (uiState.expanded) {
      authenticatorNode.data.focus();
      setTimeout(() => {
        document.addEventListener("click", listenForClose);
        document.addEventListener("keyup", listenForClose);
      }, 1);
    } else {
      removeListenForClose();
    }
  }}
		>☰</div>
		<div ${id("menu", HTMLDivElement)} style='
			display: none;
			position: absolute;
			border: 1px solid gray;
			border-radius: 0.25rem;
			background-color: white;
			padding: 0.5rem;
			box-shadow: -0.125rem 0.125rem 0.25rem lightgray;
		'>${node("authenticator", authenticatorNode)}</div>
	</accountmenu>`.onadd(async (self2) => {
    if (!initialState) {
      const state = await api.getState(null);
      authenticatorNode.data.setState(state);
      self2.data.user = state.user?.username || "";
    }
  }).extend((self2) => ({
    data: {
      onchange: (callback) => {
        listeners.add(callback);
      },
      removeonchange: (callback) => {
        listeners.delete(callback);
      }
    }
  }));
  return self;
};
export {
  accountMenu
};
