// node_modules/wirejs-dom/lib/v2/util.js
function randomId() {
  return `${(/* @__PURE__ */ new Date()).getTime()}_${Math.floor(Math.random() * 1e6)}`;
}
function matchingAttribute(node, id) {
  for (const attribute of node.attributes) {
    if (attribute.value === id)
      return attribute;
  }
  return null;
}
function getAttributeUnder(root, id) {
  const q = [root];
  while (q.length > 0) {
    const node = q.shift();
    if (!node)
      return;
    const attribute = matchingAttribute(node, id);
    if (attribute) {
      return attribute;
    }
    for (const child of node.children) {
      q.push(child);
    }
  }
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
      const node = nodeRef.deref();
      if (node) {
        const wasInDom = nodeDomStatus.get(node);
        const isInDom = document.contains(node);
        const wasAdded = isInDom && !wasInDom;
        const wasRemoved = wasInDom && !isInDom;
        nodeDomStatus.set(node, isInDom);
        if (wasAdded) {
          registeredCallbacks.get(node)?.onadd();
        } else if (wasRemoved) {
          registeredCallbacks.get(node)?.onremove();
        }
      } else {
        monitoredNodes.delete(nodeRef);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
function registerNodeDomCallbacks(node, callbacks) {
  ensureRunning();
  monitoredNodes.add(new WeakRef(node));
  registeredCallbacks.set(node, callbacks);
  nodeDomStatus.set(node, document.contains(node));
}
function tryToCall(f) {
  try {
    f();
  } catch (e) {
    console.error(e);
  }
}
function addWatcherHooks(node) {
  const onAddWatchers = [];
  const onRemoveWatchers = [];
  let registered = false;
  const ensureCallbacksAreRegistered = () => {
    if (registered)
      return;
    registerNodeDomCallbacks(node, {
      onadd: () => onAddWatchers.forEach(tryToCall),
      onremove: () => onRemoveWatchers.forEach(tryToCall)
    });
    registered = true;
  };
  node.onadd = (f) => {
    ensureCallbacksAreRegistered();
    onAddWatchers.push(() => f(node));
    return node;
  };
  node.onremove = (f) => {
    ensureCallbacksAreRegistered();
    onRemoveWatchers.push(() => f(node));
    return node;
  };
}

// node_modules/wirejs-dom/lib/v2/components/html.js
function html(raw, ...builders) {
  const adjustedBuilders = builders.map((b) => {
    if (typeof b === "function") {
      const id = randomId();
      return {
        id,
        toString() {
          return id;
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
  const node = {
    doctype: container.documentElement,
    html: container.documentElement,
    head: container.head,
    body: container.body
  }[firstNode] || container.body.firstElementChild;
  node.data = {};
  for (const builder of adjustedBuilders) {
    if (!builder)
      continue;
    if (typeof builder !== "object")
      continue;
    let accessor = void 0;
    if ("handler" in builder && typeof builder.handler === "function") {
      const fAttr = getAttributeUnder(node, builder.id);
      const el = fAttr?.ownerElement;
      el?.removeAttribute(fAttr.name);
      el && (el[fAttr.name] = builder.handler);
    }
    if ("bless" in builder && typeof builder.bless === "function") {
      accessor = builder.bless({ container: node, data: node.data });
    }
    if ("id" in builder && typeof builder.id === "string") {
      appendAccessor(node, builder.id, accessor);
    }
  }
  addWatcherHooks(node);
  addExtends(node);
  return node;
}
var knownAccessors = /* @__PURE__ */ new WeakMap();
function appendAccessor(node, propName, accessor) {
  if (!knownAccessors.has(node.data)) {
    const dataProp = node.data;
    knownAccessors.set(dataProp, {});
    Object.defineProperty(node, "data", {
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
  const nodeAccessor = knownAccessors.get(node.data);
  if (!nodeAccessor[propName]) {
    const nodePropAccessors = [];
    nodeAccessor[propName] = nodePropAccessors;
    Object.defineProperty(node.data, propName, {
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

// src/ssg/index.ts
async function generate() {
  const page = html`
		<!doctype html>
		<html>
			<head>
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Welcome!</title>
			</head>
			<body>
				<h1>Welcome!</h1>
				<p>This is your wirejs app!</p>
				<p>It comes with some sample API methods and pages.</p>
				<ul>
					<li><a href='/todo-app.html'>Todo App</a></li>
					<li><a href='/simple-wiki/index.html'>Simple Wiki</a></li>
				</ul>
			</body>
		</html>
	`;
  return page;
}
export {
  generate
};
