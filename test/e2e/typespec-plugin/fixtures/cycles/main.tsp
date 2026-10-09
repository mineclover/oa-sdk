import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{
  title: "Recursive Graph Service"
})
@info(#{
  version: "1.0.0"
})
namespace GraphService;

model TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  parent?: TreeNode;
}

model Comment {
  id: string;
  author: string;
  content: string;
  replies?: Comment[];
}

@route("/tree")
namespace Trees {
  @get
  op getRoot(): TreeNode;

  @get
  @route("/comments/{id}")
  op getCommentTree(@path id: string): Comment;
}
