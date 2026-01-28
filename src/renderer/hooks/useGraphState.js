import { useReducer, useMemo } from 'react';
import { logger } from '../../shared/logger';
import { applyNodeChanges, applyEdgeChanges } from 'reactflow';

// Action types
const ACTIONS = {
  SET_NODES: 'SET_NODES',
  SET_EDGES: 'SET_EDGES',
  ON_NODES_CHANGE: 'ON_NODES_CHANGE',
  ON_EDGES_CHANGE: 'ON_EDGES_CHANGE',
  SELECT_NODE: 'SELECT_NODE',
  RESET: 'RESET'
};

const initialState = {
  nodes: [],
  edges: [],
  selectedNodeId: null
};

function normalizeCollection(value, label) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  logger.warn(`[GraphState] Expected array for ${label}, got`, value);
  return [];
}

function graphReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_NODES: {
      const newNodes =
        typeof action.payload === 'function' ? action.payload(state.nodes) : action.payload;
      return { ...state, nodes: normalizeCollection(newNodes, 'nodes') };
    }
    case ACTIONS.SET_EDGES: {
      const newEdges =
        typeof action.payload === 'function' ? action.payload(state.edges) : action.payload;
      return { ...state, edges: normalizeCollection(newEdges, 'edges') };
    }
    case ACTIONS.ON_NODES_CHANGE:
      return {
        ...state,
        nodes: applyNodeChanges(action.payload, state.nodes)
      };
    case ACTIONS.ON_EDGES_CHANGE:
      return {
        ...state,
        edges: applyEdgeChanges(action.payload, state.edges)
      };
    case ACTIONS.SELECT_NODE: {
      const newSelected =
        typeof action.payload === 'function'
          ? action.payload(state.selectedNodeId)
          : action.payload;
      return { ...state, selectedNodeId: newSelected };
    }
    case ACTIONS.RESET:
      return initialState;
    default:
      return state;
  }
}

export function useGraphState() {
  const [state, dispatch] = useReducer(graphReducer, initialState);

  const actions = useMemo(
    () => ({
      setNodes: (nodesOrUpdater) => {
        dispatch({ type: ACTIONS.SET_NODES, payload: nodesOrUpdater });
      },
      setEdges: (edgesOrUpdater) => {
        dispatch({ type: ACTIONS.SET_EDGES, payload: edgesOrUpdater });
      },
      onNodesChange: (changes) => {
        dispatch({ type: ACTIONS.ON_NODES_CHANGE, payload: changes });
      },
      onEdgesChange: (changes) => {
        dispatch({ type: ACTIONS.ON_EDGES_CHANGE, payload: changes });
      },
      selectNode: (nodeIdOrUpdater) => {
        dispatch({ type: ACTIONS.SELECT_NODE, payload: nodeIdOrUpdater });
      },
      reset: () => {
        dispatch({ type: ACTIONS.RESET });
      }
    }),
    []
  );

  return {
    nodes: state.nodes,
    edges: state.edges,
    selectedNodeId: state.selectedNodeId,
    actions
  };
}
